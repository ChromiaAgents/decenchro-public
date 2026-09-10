import { NextResponse } from "next/server";

import { getOwner, isRequestAuthed } from "@/lib/dashboard/auth";
import { telegramReuse } from "@/lib/dashboard/telegram-token";

// GET /api/deploy/reuse — can the deploy form offer "saved · leave blank to keep"
// for the Telegram token?
//
// The same answer is computed server-side in app/dashboard/page.tsx and passed to
// the form as a prop, but a prop cannot be trusted to be current here: the deploy
// form lives at /dashboard, the other sections are their own routes, and Next's
// router cache can serve a /dashboard RSC payload from earlier in the session on
// a client-side navigation back. If the token became reusable after that payload
// was built — the operator saved it, or the agent holding it was removed — the
// form showed the "create a bot with @BotFather" placeholder for a token the
// company already has, and only a hard refresh corrected it.
//
// So the form asks on mount and lets the answer win over the prop. Deliberately a
// boolean and nothing else: the token stays server-side, and a blank field is
// resolved inside provisionAgent.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ telegram: false });
  try {
    const reuse = await telegramReuse(owner.companyId);
    // Held by a live agent means it is not free to reuse, which is exactly the
    // condition app/dashboard/page.tsx applies.
    return NextResponse.json({
      telegram: Boolean(reuse.token) && !reuse.heldBy,
      heldBy: reuse.heldBy ?? null,
    });
  } catch {
    // A failed lookup must not turn into a false offer: the form falls back to
    // asking for a token, which always works.
    return NextResponse.json({ telegram: false });
  }
}
