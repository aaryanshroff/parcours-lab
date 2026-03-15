import { createClient } from "@/lib/supabase/client";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!API_BASE_URL) {
  throw new Error(
    "Missing NEXT_PUBLIC_API_BASE_URL. Set it in frontend/.env.local or your deployment environment.",
  );
}

const supabase = createClient();

/**
 * Fetch wrapper that automatically injects the Supabase auth token.
 * Drop-in replacement for `fetch` — same signature, same return type.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init?.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  return fetch(input, { ...init, headers });
}
