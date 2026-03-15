"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    // The Supabase client automatically detects the auth tokens in the URL
    // fragment and exchanges them for a session. We just need to wait for it.
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        router.replace("/");
      }
    });
  }, [router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-muted-foreground">Signing you in…</p>
    </div>
  );
}
