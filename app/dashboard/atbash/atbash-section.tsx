"use client";

import { useRouter } from "next/navigation";

import { AtbashView, ScopeBar } from "../dashboard-client";

export function AtbashSection({
  scopedAgentPubkey,
  scopedFingerprint,
}: {
  scopedAgentPubkey?: string;
  scopedFingerprint?: string;
}) {
  const router = useRouter();
  return (
    <div className="animate-reveal">
      {scopedFingerprint && (
        <ScopeBar
          fingerprint={scopedFingerprint}
          // Clearing the scope is a navigation now, so back still works.
          onClear={() => router.push("/dashboard/atbash")}
        />
      )}
      <AtbashView scopedAgentPubkey={scopedAgentPubkey} />
    </div>
  );
}
