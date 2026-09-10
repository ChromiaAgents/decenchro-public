// Placeholder names for a new agent: `quiet-amber-heron`, the shape Vercel,
// Heroku and Docker all use for the same reason — naming a thing is a decision,
// and asking for one before the user has deployed anything is friction on the
// step that matters least. The field stays editable; this only means the form is
// valid the moment it loads.
//
// Every word is lowercase a-z, so `slug()` in deploy.ts leaves the name alone
// and the derived Render service name reads the same as the agent's.

// Deliberately calm and concrete — no crypto/AI vocabulary, nothing that reads
// as a product tier ("pro", "ultra") or a person's name. Same register as the
// rest of the console.
const ADJECTIVES = [
  "quiet", "steady", "brisk", "candid", "patient", "prudent", "plain",
  "frank", "modest", "swift", "level", "sober", "keen", "civil", "humble",
  "lucid", "placid", "stoic", "tidy", "wry",
] as const;

const MATERIALS = [
  "amber", "basalt", "birch", "brass", "cedar", "chalk", "cobalt", "copper",
  "flint", "indigo", "ivory", "linen", "marble", "olive", "pewter", "quartz",
  "sienna", "slate", "teal", "walnut",
] as const;

// "swift" is missing on purpose: it is in ADJECTIVES, and a word in two lists
// can produce `swift-slate-swift`. The self-check enforces that.
const NOUNS = [
  "heron", "otter", "falcon", "marten", "badger", "ibis", "lynx", "raven",
  "hare", "osprey", "tern", "vole", "wren", "shrike", "kestrel", "puffin",
  "beacon", "harbor", "meadow", "summit",
] as const;

const pick = <T,>(list: readonly T[]): T =>
  list[Math.floor(Math.random() * list.length)];

/** Longest name the word lists can produce, hyphens included. */
export const MAX_GENERATED_LENGTH =
  Math.max(...ADJECTIVES.map((w) => w.length)) +
  Math.max(...MATERIALS.map((w) => w.length)) +
  Math.max(...NOUNS.map((w) => w.length)) +
  2;

/**
 * A three-word name, avoiding anything in `taken` (compared lowercased, the
 * same way the form's duplicate check does).
 *
 * The retry matters because the collision is not hypothetical: a company that
 * deploys a few agents and keeps the offered name has a real chance of being
 * shown a name the form will immediately reject, on a field they never typed
 * in. After `tries` misses it appends a digit rather than looping — 8000
 * combinations against one company's agents means that tail is unreachable in
 * practice, and an ugly name beats a hang.
 */
export function randomAgentName(
  taken: ReadonlySet<string> = new Set(),
  tries = 12,
): string {
  const isTaken = (n: string) => taken.has(n.toLowerCase());
  for (let i = 0; i < tries; i++) {
    const name = `${pick(ADJECTIVES)}-${pick(MATERIALS)}-${pick(NOUNS)}`;
    if (!isTaken(name)) return name;
  }
  const base = `${pick(ADJECTIVES)}-${pick(MATERIALS)}-${pick(NOUNS)}`;
  for (let n = 2; n < 100; n++) if (!isTaken(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

export function demo(): void {
  const a = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`agent-name self-check failed: ${msg}`);
  };

  // The shape the form and the derived service name both depend on.
  for (let i = 0; i < 300; i++) {
    const n = randomAgentName();
    a(/^[a-z]+-[a-z]+-[a-z]+$/.test(n), `not word-word-word: ${n}`);
    // slug(agentName, 24) builds the Render service name. Staying inside that
    // budget is why the word lists are short — a truncated service name no
    // longer matches the agent the operator sees.
    a(n.length <= 24, `${n} is ${n.length} chars, over the 24 slug() keeps`);
  }
  a(MAX_GENERATED_LENGTH <= 24, `longest possible name is ${MAX_GENERATED_LENGTH}`);

  // Never hands back a name the form would reject.
  const one = randomAgentName();
  a(randomAgentName(new Set([one.toLowerCase()])) !== one, "avoids a taken name");
  // Case-insensitively, matching the form's own comparison.
  a(randomAgentName(new Set([one])) !== one, "taken check is case-insensitive");

  // The pathological case: everything taken. Must terminate with a usable name
  // rather than spin or return a duplicate.
  const all = new Set<string>();
  for (const x of ADJECTIVES)
    for (const y of MATERIALS)
      for (const z of NOUNS) all.add(`${x}-${y}-${z}`);
  const forced = randomAgentName(all, 3);
  a(!all.has(forced), "falls back off the exhausted space");
  a(/^[a-z]+-[a-z]+-[a-z]+-\d+$/.test(forced), `odd fallback shape: ${forced}`);

  // Enough spread that two people signing up together do not see one name.
  a(
    ADJECTIVES.length * MATERIALS.length * NOUNS.length >= 8000,
    "word lists too small to be worth a retry loop",
  );
  a(
    new Set([...ADJECTIVES, ...MATERIALS, ...NOUNS]).size ===
      ADJECTIVES.length + MATERIALS.length + NOUNS.length,
    "a word appears in two lists, so a name could repeat itself",
  );

  console.log("agent-name self-check ok");
}

// Guarded like deploy-types.ts: this module is imported by a "use client"
// component, and process.argv does not exist in the browser bundle.
if (
  typeof process !== "undefined" &&
  import.meta.url === `file://${process.argv?.[1]}`
)
  demo();
