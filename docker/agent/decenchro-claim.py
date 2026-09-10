#!/usr/bin/env python3
"""decenchro first-message owner claim (trust-on-first-use).

A cloud agent runs on a server the operator has no shell access to, so Hermes'
normal pairing flow (`hermes pairing approve …`, run on the box) can never be
completed. This watcher promotes the FIRST user who messages the agent on each
platform (Telegram, WhatsApp) to Hermes' approved (owner) list, then exits once
every platform is claimed. Everyone after them stays gated, i.e. the agent is
private to its first chatter per platform.

It writes Hermes' pairing files directly — stdlib only, NO Hermes imports and
NO venv. Earlier this imported `gateway.pairing`, which made it depend on the
venv interpreter resolving on PATH and on `get_hermes_dir()` picking the same
pairing directory the running gateway uses. Under systemd those assumptions can
silently diverge and the claim never lands. Reading/writing the JSON directly,
and probing both known pairing-dir layouts, removes every one of those moving
parts. Hermes' `is_approved()` reads the approved file fresh on each message, so
a direct write authorises the user on their next message.
"""
import json
import os
import tempfile
import time
import urllib.parse
import urllib.request

PLATFORMS = ("telegram", "whatsapp")
HOME = os.path.expanduser("~")
# HERMES_HOME when the runtime sets it (the container image exports
# HERMES_HOME=/opt/data, where the hermes user's home IS the state dir), else the
# VM layout's ~/.hermes. Same precedence as agent-metrics.py.
HERMES = os.environ.get("HERMES_HOME") or os.path.join(HOME, ".hermes")
# Hermes resolves its pairing dir as the legacy `pairing/` when it already
# exists, otherwise the newer `platforms/pairing/`. Probe both so we always act
# on whichever one the running gateway is actually using.
CANDIDATE_DIRS = [
    os.path.join(HERMES, "pairing"),
    os.path.join(HERMES, "platforms", "pairing"),
]
def _sentinel(platform):
    # The bare name is the pre-WhatsApp Telegram sentinel; keep reading it so
    # an already-claimed agent is not re-claimed by a later chatter.
    if platform == "telegram":
        return os.path.join(HERMES, ".decenchro-claimed")
    return os.path.join(HERMES, f".decenchro-claimed-{platform}")
POLL_SECONDS = 2
GIVE_UP_AFTER = 7 * 24 * 3600  # a week


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _atomic_write(path, data):
    """Temp-file + rename so the gateway never reads a half-written file."""
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(data, indent=2, ensure_ascii=False))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _pending_name(platform):
    return f"{platform}-pending.json"


def _pairing_dir(platform):
    """The dir the gateway is actually using: prefer one that already holds a
    pending file, else the first that exists, else the new-layout default."""
    for d in CANDIDATE_DIRS:
        if os.path.exists(os.path.join(d, _pending_name(platform))):
            return d
    for d in CANDIDATE_DIRS:
        if os.path.isdir(d):
            return d
    return CANDIDATE_DIRS[-1]


def notify(bot_token, chat_id):
    """Best-effort 'you're the owner' DM so the user ignores the pairing code."""
    if not bot_token or not chat_id:
        return
    try:
        data = urllib.parse.urlencode(
            {
                "chat_id": chat_id,
                "text": (
                    "✓ You're this agent's owner. That first message was used to "
                    "pair you, so it never reached the agent — send it again and "
                    "it will answer."
                ),
            }
        ).encode()
        urllib.request.urlopen(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            data=data,
            timeout=10,
        )
    except Exception:
        pass


def claimed(platform):
    return os.path.exists(_sentinel(platform))


def claim_once(platform):
    """Approve the oldest pending request, if any. Returns True once claimed."""
    directory = _pairing_dir(platform)
    pending = _load(os.path.join(directory, _pending_name(platform)))
    entries = [
        (eid, e)
        for eid, e in pending.items()
        if isinstance(e, dict)
        and str(e.get("user_id", "")).strip()
        and isinstance(e.get("created_at"), (int, float))
    ]
    if not entries:
        return False
    # Oldest created_at = the first person who messaged the bot.
    entries.sort(key=lambda kv: kv[1]["created_at"])
    first = entries[0][1]
    uid = str(first["user_id"]).strip()
    name = first.get("user_name", "") or ""

    approved_path = os.path.join(directory, f"{platform}-approved.json")
    approved = _load(approved_path)
    approved[uid] = {"user_name": name, "approved_at": time.time()}
    _atomic_write(approved_path, approved)

    # Drop the request we just approved. Hermes does not clear it on its own, so
    # without this the owner's pairing request sits in the console's pending list
    # forever, reading as "waiting for approval" long after it was approved.
    # Every OTHER pending entry stays: those are people who are not the owner and
    # whose requests are still genuinely outstanding.
    remaining = {
        eid: e
        for eid, e in pending.items()
        if not (isinstance(e, dict) and str(e.get("user_id", "")).strip() == uid)
    }
    if len(remaining) != len(pending):
        _atomic_write(os.path.join(directory, _pending_name(platform)), remaining)

    if platform == "telegram":
        # WhatsApp has no out-of-band send from here; Hermes' own pairing
        # reply already told them to resend once approved.
        notify(os.environ.get("TELEGRAM_BOT_TOKEN", ""), uid)
    try:
        with open(_sentinel(platform), "w") as f:
            f.write(uid + "\n")
    except OSError:
        pass
    return True


def main():
    deadline = time.time() + GIVE_UP_AFTER
    while time.time() < deadline:
        open_platforms = [p for p in PLATFORMS if not claimed(p)]
        if not open_platforms:
            return
        for platform in open_platforms:
            try:
                claim_once(platform)
            except Exception:
                # Never let a transient read/write error kill the watcher.
                pass
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
