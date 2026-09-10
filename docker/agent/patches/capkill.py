#!/usr/bin/env python3
"""Build-time patch for hermes_cli/service_manager.py: same-uid signal fallback.

Render runs the container without CAP_KILL (CapEff 0x400cb, measured
2026-08-27). s6-supervise is root, the gateway is uid 10000, so the kill()
behind `s6-svc -t` / `s6-svc -d` fails and both return 0 having done nothing:
every "Restart gateway" / "Save and restart" in the Hermes console was a
silent no-op, which is why an enabled WhatsApp bridge never started.

`hermes gateway restart|stop` itself runs as uid 10000 — the SAME uid as the
service — and same-uid kill() needs no capability. So after asking s6, wait a
beat; if the supervised pid is unchanged, signal it ourselves. SIGUSR1 is the
gateway's own graceful restart (drain → exit 75 → s6 respawns, which is a
plain fork and works without CAP_KILL); SIGTERM is its planned stop and the
planned-stop marker has already been written by then.

Anchored on exact source text so a base bump that rewrites these methods
fails the build here instead of shipping an image where restart is a no-op
again. Usage: capkill.py <path-to-service_manager.py>
"""
import sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()

OLD_RESTART = '''        self._run_svc("-t", "restart", name)
        _write_gateway_desired_state(name, "running")
'''
NEW_RESTART = '''        pid = _decenchro_supervised_pid(self, name)
        self._run_svc("-t", "restart", name)
        _decenchro_signal_fallback(self, name, pid, "SIGUSR1")
        _write_gateway_desired_state(name, "running")
'''
OLD_STOP = '''        self._run_svc("-d", "stop", name)
        _write_gateway_desired_state(name, "stopped")
'''
NEW_STOP = '''        pid = _decenchro_supervised_pid(self, name)
        self._run_svc("-d", "stop", name)
        _decenchro_signal_fallback(self, name, pid, "SIGTERM")
        _write_gateway_desired_state(name, "stopped")
'''
OLD_PID_RE = '''        m = re.search(r"\\(pid (\\d+)\\)", result.stdout)'''
NEW_PID_RE = '''        m = re.search(r"\\(pid (\\d+)[ )]", result.stdout)  # decenchro: s6 2.13 prints "(pid N pgid N)"'''

HELPER = '''

def _decenchro_supervised_pid(mgr, name):
    """Pid of the supervised child via `s6-svstat -o pid` (one bare number,
    immune to the human-format drift that broke the regex above)."""
    import subprocess

    try:
        r = subprocess.run(
            [f"{_S6_BIN_DIR}/s6-svstat", "-o", "pid", str(mgr.scandir / name)],
            capture_output=True, text=True, timeout=5,
        )
        return int(r.stdout.strip()) if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None

def _decenchro_signal_fallback(mgr, name, pid, signame):
    """decenchro (docker/agent/patches/capkill.py): the host may drop CAP_KILL,
    in which case root s6-supervise cannot signal its uid-10000 child and
    s6-svc reports success having done nothing. We share the child's uid, so
    if it is still the same pid a moment later, signal it ourselves."""
    import os
    import signal
    import time

    if pid is None:
        return
    time.sleep(1.0)
    if _decenchro_supervised_pid(mgr, name) != pid:
        return  # s6 did its job
    try:
        os.kill(pid, getattr(signal, signame))
    except ProcessLookupError:
        pass
'''

for label, old in (("restart", OLD_RESTART), ("stop", OLD_STOP), ("pid regex", OLD_PID_RE)):
    n = src.count(old)
    assert n == 1, f"capkill: expected exactly one {label} anchor, found {n} — base image changed, re-check the patch"
assert "_decenchro_signal_fallback" not in src, "capkill: already applied"

src = src.replace(OLD_RESTART, NEW_RESTART).replace(OLD_STOP, NEW_STOP).replace(OLD_PID_RE, NEW_PID_RE) + HELPER
open(path, "w", encoding="utf-8").write(src)
print("capkill: patched", path)
