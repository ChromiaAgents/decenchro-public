import { getAttestation } from "@/lib/dashboard/erc8004-attestations";

export const dynamic = "force-dynamic";

// GET /api/agents/attestation/<id> — the exact bytes whose keccak256 is on the
// ERC-8004 ValidationRegistry as this attestation's request/response hash.
// Public by design (it is the on-chain requestURI/responseURI); rows are keyed
// by unguessable uuid and contain only aggregate audit counts. Served verbatim
// from the stored string — NOT re-serialized — so the hash always verifies.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await getAttestation(id);
  if (!row) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(row.summary, {
    headers: {
      "content-type": "application/json",
      // The summary is immutable once written.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
