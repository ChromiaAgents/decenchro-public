import fs from "node:fs/promises";
import path from "node:path";

import { HERMES_CONFIG } from "./paths";

// Path = ["agent", "reasoning_effort"] or ["unauthorized_dm_behavior"].
export type Scalar = string | number | boolean;

async function readLines(): Promise<string[]> {
  try {
    const raw = await fs.readFile(HERMES_CONFIG, "utf8");
    return raw.split(/\r?\n/);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

function detectIndent(lines: string[]): string {
  for (const l of lines) {
    const m = /^(\s+)\S/.exec(l);
    if (m) return m[1];
  }
  return "  ";
}

function quoteValue(v: Scalar): string {
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  // Quote anything with whitespace, colons, comment chars, or YAML truthy aliases.
  const needsQuote = /[\s:#,'"{}[\]&*!|>%@`?]/.test(v) || /^(true|false|null|yes|no|on|off)$/i.test(v);
  if (!needsQuote) return v;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseScalarFromLine(rest: string): string {
  let v = rest.trim();
  // strip inline comment (best-effort: ignore # inside quotes)
  let inQ: string | null = null;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (inQ) {
      if (c === inQ && v[i - 1] !== "\\") inQ = null;
    } else {
      if (c === '"' || c === "'") inQ = c;
      else if (c === "#") {
        v = v.slice(0, i).trim();
        break;
      }
    }
  }
  // strip surrounding quotes
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

// Line-by-line block scanner. For a top-level key, the block runs until the
// next top-level key. For a nested key, we look at any line within the parent
// block whose indent is one level deeper.
function findScalar(
  lines: string[],
  pathSegments: string[],
): { index: number; value: string } | null {
  const indent = detectIndent(lines);
  let depth = 0; // expected indent for the current target
  let from = 0;
  let to = lines.length;

  for (let p = 0; p < pathSegments.length; p++) {
    const seg = pathSegments[p];
    const prefix = indent.repeat(depth);
    const re = new RegExp(`^${prefix}${seg}\\s*:\\s*(.*)$`);
    let found = -1;
    for (let i = from; i < to; i++) {
      const m = re.exec(lines[i]);
      if (!m) {
        // skip lines deeper than the expected depth
        if (depth > 0 && /^\s*#/.test(lines[i])) continue;
        if (lines[i].startsWith(prefix + indent)) continue;
        // a line at the same-or-shallower indent that is NOT our key ends the parent block scope
        if (lines[i].trim().length > 0 && !lines[i].startsWith(prefix + indent)) {
          // continue scanning — could be a sibling
        }
        continue;
      }
      found = i;
      break;
    }
    if (found === -1) return null;

    if (p === pathSegments.length - 1) {
      const trailing = re.exec(lines[found])![1];
      return { index: found, value: parseScalarFromLine(trailing) };
    }

    // descend
    from = found + 1;
    depth++;
    // shrink `to` to the end of this parent block
    const childPrefix = indent.repeat(depth);
    for (let j = from; j < to; j++) {
      const t = lines[j];
      if (t.trim().length === 0 || /^\s*#/.test(t)) continue;
      if (!t.startsWith(childPrefix)) {
        to = j;
        break;
      }
    }
  }
  return null;
}

export async function readScalars(
  paths: string[][],
): Promise<Record<string, string | null>> {
  const lines = await readLines();
  const out: Record<string, string | null> = {};
  for (const p of paths) {
    const key = p.join(".");
    const hit = findScalar(lines, p);
    out[key] = hit ? hit.value : null;
  }
  return out;
}

export async function writeScalars(
  updates: Array<{ path: string[]; value: Scalar }>,
): Promise<{ updated: string[]; appended: string[] }> {
  await fs.mkdir(path.dirname(HERMES_CONFIG), { recursive: true });
  const lines = await readLines();
  const indent = detectIndent(lines);
  const updated: string[] = [];
  const appended: string[] = [];

  for (const { path: segs, value } of updates) {
    const hit = findScalar(lines, segs);
    const newLineKey = segs[segs.length - 1];
    const newLineIndent = indent.repeat(segs.length - 1);
    const newLine = `${newLineIndent}${newLineKey}: ${quoteValue(value)}`;

    if (hit) {
      lines[hit.index] = newLine;
      updated.push(segs.join("."));
      continue;
    }

    // Not found — for top-level keys, just append. For nested keys we skip
    // (caller should restrict to known-existing paths in v0).
    if (segs.length === 1) {
      lines.push(newLine);
      appended.push(segs.join("."));
    } else {
      // Nested missing: don't auto-create the parent block. Surface as failure.
      throw new Error(
        `cannot patch nested key ${segs.join(".")} — parent block missing in config.yaml`,
      );
    }
  }

  await fs.writeFile(HERMES_CONFIG, lines.join("\n"));
  return { updated, appended };
}
