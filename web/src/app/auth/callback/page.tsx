'use client';

import { useAuth } from '@/auth';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function AuthCallbackPage() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function resolveGoogleSignIn() {
      const supabase = createBrowserSupabaseClient();
      if (!supabase) {
        if (active) {
          setError('Supabase browser auth is not configured.');
        }
        return;
      }

      try {
        const code = searchParams.get('code');
        let accessToken: string | null = null;

        if (code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
          accessToken = data.session?.access_token ?? null;
        }

        if (!accessToken && typeof window !== 'undefined' && window.location.hash) {
          const hashParams = new URLSearchParams(window.location.hash.slice(1));
          accessToken = hashParams.get('access_token');
        }

        if (!accessToken) {
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) {
            throw sessionError;
          }
          accessToken = data.session?.access_token ?? null;
        }

        if (!accessToken) {
          throw new Error('No Supabase session returned from Google sign-in.');
        }

        login(accessToken);

        const next = searchParams.get('next') || '/';
        router.replace(next);
      } catch (callbackError) {
        if (active) {
          setError(callbackError instanceof Error ? callbackError.message : 'Google sign-in failed.');
        }
      }
    }

    void resolveGoogleSignIn();

    return () => {
      active = false;
    };
  }, [login, router, searchParams]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-[28px] border border-[#ead9ca] bg-white/80 p-8 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7a4b28]">Google Sign-In</p>
        <h1 className="mt-3 text-2xl font-semibold text-[#1d140d]">Finishing authentication</h1>
        <p className="mt-3 text-sm text-[#5f5145]">
          {error ? error : 'Steady AI is completing your Google sign-in and restoring your session.'}
        </p>
      </div>
    </main>
  );
}
