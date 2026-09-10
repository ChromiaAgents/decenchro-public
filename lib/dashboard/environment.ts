// Which deployment of the console this is.
//
// One Vercel project serves production (`main` → decenchro.com) and staging
// (`uat` → staging.decenchro.com), against two different Neon databases. The two
// look identical, which is how someone ends up deploying a real agent from what
// they thought was staging. Stripe's answer is a sandbox banner you cannot miss;
// this is the same idea.
//
// Read on the SERVER and passed down as a prop. VERCEL_ENV is not
// NEXT_PUBLIC_-prefixed, so a client component cannot see it, and inferring the
// environment from location.hostname would break on every preview URL.

export type AppEnvironment = "production" | "staging" | "local";

export function appEnvironment(
  env: { VERCEL_ENV?: string; NODE_ENV?: string } = process.env,
): AppEnvironment {
  // VERCEL_ENV is the authority where it exists: "production" only for the
  // production target, "preview" for every branch build including uat.
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "staging";
  // No VERCEL_ENV at all: a local dev server or a self-hosted run. Treated as
  // local rather than production, because guessing "production" here would hide
  // the banner exactly where the database is most likely to be a scratch one.
  return "local";
}

/** Banner copy. Null for production, which gets no banner at all. */
export function environmentBanner(
  environment: AppEnvironment,
): { label: string; detail: string } | null {
  if (environment === "staging")
    return {
      label: "Sandbox",
      detail: "Staging environment, separate database. Agents deployed here are real and bill real credits.",
    };
  if (environment === "local")
    return {
      label: "Local",
      detail: "Development server. Deploys still create real Render services and real on-chain identities.",
    };
  return null;
}

export function demo(): void {
  const a = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`environment self-check failed: ${msg}`);
  };

  a(appEnvironment({ VERCEL_ENV: "production" }) === "production", "production target");
  a(appEnvironment({ VERCEL_ENV: "preview" }) === "staging", "uat is a preview build");
  a(appEnvironment({}) === "local", "no VERCEL_ENV is local, never production");
  a(
    appEnvironment({ NODE_ENV: "production" }) === "local",
    "a production BUILD is not the production environment — next build sets this locally too",
  );

  a(environmentBanner("production") === null, "production shows no banner");
  a(environmentBanner("staging")?.label === "Sandbox", "staging is the sandbox");
  a(environmentBanner("local")?.label === "Local", "local says so");
  // The one thing the copy must never imply: that nothing here costs money.
  for (const e of ["staging", "local"] as const) {
    a(/real/i.test(environmentBanner(e)!.detail), `${e} says the side effects are real`);
  }

  console.log("environment self-check ok");
}

if (
  typeof process !== "undefined" &&
  import.meta.url === `file://${process.argv?.[1]}`
)
  demo();
