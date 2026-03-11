'use client';

import { useAuth } from '@/auth';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useMemo, useState } from 'react';

function SignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    isHydrated,
    isAuthenticated,
    isGoogleAuthConfigured,
    isAppleAuthConfigured,
    isPasswordAuthConfigured,
    isSigningInWithGoogle,
    isSigningInWithApple,
    isSigningInWithPassword,
    signInWithGoogle,
    signInWithApple,
    signInWithPassword
  } = useAuth();
  const [email, setEmail] = useState('reviewer-demo@goodhealth247.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const next = useMemo(() => searchParams.get('next') || '/onboarding', [searchParams]);

  if (isHydrated && isAuthenticated) {
    router.replace(next);
  }

  async function handlePasswordSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await signInWithPassword(email, password, { redirectTo: next });
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Unable to sign in.');
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,240,220,0.95),_rgba(246,236,226,0.88)_38%,_rgba(244,239,232,1)_100%)] px-4 py-10 text-[#1d140d] sm:px-6">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[36px] border border-white/70 bg-white/72 p-8 shadow-[0_30px_120px_rgba(80,48,24,0.1)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#7a4b28]">Steady AI Access</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight">Sign in with the reviewer demo account or your normal provider.</h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-[#5f5145]">
            This sign-in page is intended to give reviewers immediate access without account creation. Email/password works directly against the existing Supabase auth project.
          </p>
          <div className="mt-8 rounded-[28px] border border-[#ead9ca] bg-[#fffaf5] p-5 text-sm text-[#5f5145]">
            <p className="font-semibold text-[#1d140d]">Reviewer flow</p>
            <p className="mt-2">Use the demo email and password provided in the OpenAI submission. No signup, OTP, or 2FA should be required.</p>
          </div>
        </section>

        <section className="rounded-[36px] border border-[#e8d7c6] bg-[#1d140d] p-8 text-white shadow-[0_30px_120px_rgba(29,20,13,0.24)]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#d8c0ad]">Sign in</p>
          {isPasswordAuthConfigured ? (
            <form className="mt-5 space-y-4" onSubmit={handlePasswordSignIn}>
              <label className="block text-sm">
                <span className="mb-2 block text-[#d8c0ad]">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-2xl border border-[#5e4a3b] bg-[#2a1e15] px-4 py-3 text-white outline-none placeholder:text-[#9e8a7b]"
                  placeholder="reviewer-demo@goodhealth247.com"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-2 block text-[#d8c0ad]">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-2xl border border-[#5e4a3b] bg-[#2a1e15] px-4 py-3 text-white outline-none placeholder:text-[#9e8a7b]"
                  placeholder="Enter password"
                />
              </label>
              {error ? <p className="text-sm text-[#ffb4ab]">{error}</p> : null}
              <button
                type="submit"
                disabled={isSigningInWithPassword || isSigningInWithGoogle || isSigningInWithApple}
                className="w-full rounded-full bg-[#f4d4b0] px-5 py-3 text-sm font-semibold text-[#1d140d] disabled:opacity-60"
              >
                {isSigningInWithPassword ? 'Signing in...' : 'Continue with email and password'}
              </button>
            </form>
          ) : null}

          {(isGoogleAuthConfigured || isAppleAuthConfigured) ? (
            <div className="mt-6 border-t border-[#5e4a3b] pt-6">
              <p className="text-xs uppercase tracking-[0.2em] text-[#d8c0ad]">Or use a provider</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {isGoogleAuthConfigured ? (
                  <button
                    type="button"
                    onClick={() => {
                      void signInWithGoogle({ redirectTo: next });
                    }}
                    disabled={isSigningInWithPassword || isSigningInWithGoogle || isSigningInWithApple}
                    className="rounded-full bg-white px-5 py-3 text-sm font-medium text-[#1d140d] disabled:opacity-60"
                  >
                    {isSigningInWithGoogle ? 'Connecting Google...' : 'Continue with Google'}
                  </button>
                ) : null}
                {isAppleAuthConfigured ? (
                  <button
                    type="button"
                    onClick={() => {
                      void signInWithApple({ redirectTo: next });
                    }}
                    disabled={isSigningInWithPassword || isSigningInWithGoogle || isSigningInWithApple}
                    className="rounded-full border border-white/30 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {isSigningInWithApple ? 'Connecting Apple...' : 'Continue with Apple'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-6 text-sm text-[#d8c0ad]">
            <Link href="/" className="underline underline-offset-4">
              Back to homepage
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f7efe6]" />}>
      <SignInPageContent />
    </Suspense>
  );
}
