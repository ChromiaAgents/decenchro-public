export type Plan = "enterprise";

export function isExpired(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && nowMs > t;
}

export function demo(): void {
  const a = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`plan-gate self-check failed: ${msg}`);
  };
  const now = 1_000_000;
  a(isExpired(null, now) === false, "null expiry never fires");
  a(isExpired(new Date(now - 1).toISOString(), now) === true, "past expiry fires");
  a(isExpired(new Date(now + 60_000).toISOString(), now) === false, "future expiry holds");
  a(isExpired("not-a-date", now) === false, "unparseable expiry holds");
  console.log("plan-gate self-check: OK");
}

if (import.meta.url === `file://${process.argv[1]}`) demo();
