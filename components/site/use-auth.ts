"use client";

import { useCallback, useEffect, useState } from "react";

import { signOut as authSignOut } from "@/lib/auth/client";

export type AuthState = {
  loading: boolean;
  email: string | null;
  company: string | null;
};

/**
 * Auth state for the nav: who is signed in and which company they own.
 *
 * Served by /api/me rather than read from the database in the browser. Under
 * Supabase this hook held an anon-key client, queried `companies` directly and
 * leaned on row-level security to scope the result; Neon has no RLS and the app
 * has no browser database credentials, so the server answers.
 *
 * The Supabase version also re-synced on `onAuthStateChange`. Neon Auth's cookie
 * session has no such browser event, so sign-in and sign-out navigate (the forms
 * already do) and this re-fetches on mount.
 */
export function useAuth(): AuthState & { signOut: () => Promise<void> } {
  const [state, setState] = useState<AuthState>({
    loading: true,
    email: null,
    company: null,
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const data = (await res.json()) as { email: string | null; company: string | null };
        if (active) setState({ loading: false, email: data.email, company: data.company });
      } catch {
        if (active) setState({ loading: false, email: null, company: null });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await authSignOut();
    setState({ loading: false, email: null, company: null });
  }, []);

  return { ...state, signOut };
}
