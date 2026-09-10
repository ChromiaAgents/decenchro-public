"""decenchro-guard — Hermes plugin that routes tool calls through the Atbash judge.

Flow per tool call:

1. ``pre_tool_call`` fires before the agent executes a tool.
2. If the tool name matches the allowlist (env ``ATBASH_GUARDED_TOOLS``,
   comma-separated; default: ``terminal,read_file,write_file,patch,search_files,web_search,web_extract,decenchro-mem``),
   the hook spawns the Node shim with the tool name, args, and context on
   stdin and reads a JSON verdict on stdout.
3. Verdict mapping:
   - ``ALLOW``  → return ``None`` (Hermes proceeds with the tool call).
   - ``BLOCK``  → return ``{"action": "block", "message": <reason>}``.
   - ``HOLD``   → return ``{"action": "block", "message": "Held for review (...)"}``
                  (the caller can poll ``getJudgmentStatus`` separately to resume).
   - ``ERROR``  → fail closed by default (block); fail-open when
                  ``ATBASH_FAIL_OPEN=1``.

Tools not in the allowlist pass through unmodified — Atbash is not in the
critical path for low-risk reads.

Environment:

  ATBASH_AGENT_KEY        64-char hex secp256k1 private key (required).
                          Get it from the dashboard at
                          https://atbash.ai/risk-engine/agents after
                          onboarding the agent.
  ATBASH_ENDPOINT         Override judge API endpoint (default: prod).
  ATBASH_BLOCKCHAIN_RID   Override Chromia blockchain RID.
  ATBASH_GUARDED_TOOLS    Comma-separated tool allowlist. Default:
                          ``terminal,read_file,write_file,patch,search_files,web_search,web_extract,decenchro-mem``.
  ATBASH_FAIL_OPEN        ``1`` to allow tool calls when the judge errors.
                          Default: 0 (fail closed).
  ATBASH_AUDIT_ONLY       ``1`` to always allow after logging, regardless of
                          verdict. Useful for first deployment. Default: 0.
  ATBASH_NODE_BIN         Override node binary path. Default: ``node`` on PATH.
  ATBASH_GUARD_TIMEOUT    Shim timeout in seconds. Default: 12.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_PLUGIN_DIR = Path(__file__).resolve().parent
_SHIM = _PLUGIN_DIR / "bin" / "judge.mjs"

_DEFAULT_GUARDED = "terminal,read_file,write_file,patch,search_files,web_search,web_extract,decenchro-mem"


def _guarded_tools() -> set[str]:
    raw = os.environ.get("ATBASH_GUARDED_TOOLS", _DEFAULT_GUARDED)
    return {t.strip() for t in raw.split(",") if t.strip()}


def _truthy(name: str) -> bool:
    return os.environ.get(name, "").lower() in {"1", "true", "yes", "on"}


def _context_text(tool_name: str, args: Any) -> str:
    # Short, judge-readable context. The judge model uses this to reason about
    # intent; keep it factual and bounded.
    summary = f"Decenchro agent invoking tool `{tool_name}`."
    if isinstance(args, dict):
        # Pull common semantic keys without leaking large payloads.
        for key in ("command", "path", "url", "query", "content"):
            if key in args and isinstance(args[key], (str, int, float)):
                val = str(args[key])
                if len(val) > 240:
                    val = val[:240] + "…"
                summary += f" {key}={val}"
                break
    return summary


def _run_shim(payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not _SHIM.exists():
        logger.warning("decenchro-guard: shim missing at %s", _SHIM)
        return None
    node_bin = os.environ.get("ATBASH_NODE_BIN", "node")
    timeout = float(os.environ.get("ATBASH_GUARD_TIMEOUT", "12"))
    try:
        result = subprocess.run(
            [node_bin, str(_SHIM)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(_PLUGIN_DIR),
            check=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning("decenchro-guard: shim timed out after %ss", timeout)
        return {"allow": False, "verdict": "ERROR", "reason": "judge shim timeout"}
    except FileNotFoundError:
        logger.warning("decenchro-guard: node binary not found (%s)", node_bin)
        return None

    if result.returncode != 0:
        logger.warning(
            "decenchro-guard: shim failed rc=%s stderr=%s",
            result.returncode, result.stderr.strip(),
        )
        return {"allow": False, "verdict": "ERROR", "reason": result.stderr.strip() or "shim non-zero exit"}

    try:
        return json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as err:
        logger.warning("decenchro-guard: bad shim output: %s (raw=%r)", err, result.stdout)
        return {"allow": False, "verdict": "ERROR", "reason": "bad shim output"}


def on_pre_tool_call(*, tool_name: str = "", args: Any = None, **_: Any):
    if not tool_name or tool_name not in _guarded_tools():
        return None
    if not os.environ.get("ATBASH_AGENT_KEY"):
        # Not configured — stay out of the way rather than block every tool call.
        return None

    audit_only = _truthy("ATBASH_AUDIT_ONLY")
    fail_open = _truthy("ATBASH_FAIL_OPEN")

    decision = _run_shim({
        "toolName": tool_name,
        "args": args,
        "context": _context_text(tool_name, args),
    })

    if decision is None:
        # Shim unusable (missing file / node). Don't gate the agent.
        return None

    verdict = decision.get("verdict", "ERROR")
    reason = decision.get("reason") or "no reason given"
    tool_call_id = decision.get("toolCallId")

    if audit_only:
        logger.info(
            "decenchro-guard [audit] %s verdict=%s reason=%s id=%s",
            tool_name, verdict, reason, tool_call_id,
        )
        return None

    if decision.get("allow") is True or verdict == "ALLOW":
        return None

    if verdict == "HOLD":
        message = (
            f"Atbash held this tool call for operator review. "
            f"tool_call_id={tool_call_id}. Reason: {reason}. "
            "Resume only after approval in the Atbash dashboard."
        )
        return {"action": "block", "message": message}

    if verdict == "BLOCK":
        return {"action": "block", "message": f"Atbash blocked this tool call: {reason}"}

    # ERROR — judge unreachable or shim crashed.
    if fail_open:
        logger.warning("decenchro-guard: judge error, failing open (%s)", reason)
        return None
    return {"action": "block", "message": f"Atbash judge unavailable, blocking for safety: {reason}"}


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", on_pre_tool_call)
