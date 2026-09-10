import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/site/password-forms";

export const metadata = { title: "Choose a new password · decenchro" };

// ResetPasswordForm reads the one-time token out of the query string, so it
// needs a Suspense boundary to keep this page statically renderable.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
