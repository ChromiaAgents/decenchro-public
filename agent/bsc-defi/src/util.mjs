// Shared CLI plumbing: argv parsing, JSON output discipline, errors.
//
// Output contract (every command): a single JSON object or array on stdout.
// Errors are `{"error": "..."}` on stdout with exit code 1. Nothing else is
// ever printed — the Hermes agent parses stdout, and the Atbash judge sees
// the command line, so signal lives in argv and stdout, not in logs.

export class CliError extends Error {}

export const READ_ONLY_ERROR =
  'BSC_AGENT_KEY not set — this agent is read-only on BSC';

/** JSON.stringify that survives BigInt (serialized as decimal strings). */
export function toJson(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

export function output(value) {
  process.stdout.write(toJson(value) + '\n');
}

export function fail(message, extra = {}) {
  output({ error: message, ...extra });
  process.exit(1);
}

/**
 * Argv → { words, flags }. Words are bare tokens (verbs come first — the
 * audit judge only sees the first 240 chars of the command line, so the verb
 * and key params must lead). Flags are `--key value` pairs; a flag followed
 * by another `--flag` (or end of argv) is boolean true. Values may start
 * with a single `-` (negative numbers, `-5%..+5%` ranges).
 */
export function parseArgv(argv) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      words.push(a);
    }
  }
  return { words, flags };
}

/** Require a flag value; throws a uniform CliError naming the flag. */
export function requireFlag(flags, name, usage) {
  const v = flags[name];
  if (v === undefined || v === true) {
    throw new CliError(`missing --${name}${usage ? ` — usage: ${usage}` : ''}`);
  }
  return String(v);
}

/** Parse a positive decimal amount flag (human units, e.g. "0.5"). */
export function requireAmount(flags, name, usage) {
  const raw = requireFlag(flags, name, usage);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CliError(`--${name} must be a positive number, got "${raw}"`);
  }
  return raw;
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** Tx deadline: now + 10 minutes, as expected by PCS routers/NPM. */
export function deadline() {
  return BigInt(nowSeconds() + 600);
}
