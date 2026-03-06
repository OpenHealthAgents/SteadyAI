'use client';

import { useAuth } from '@/auth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const CORE_NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Coach OS' },
  { href: '/community', label: 'Community' },
  { href: '/reports', label: 'Reports' },
  { href: '/store', label: 'Store' }
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppTopNav() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const {
    isAuthenticated,
    isGoogleAuthConfigured,
    isAppleAuthConfigured,
    isSigningInWithGoogle,
    isSigningInWithApple,
    signInWithGoogle,
    signInWithApple,
    logout
  } = useAuth();
  const navItems = isAuthenticated
    ? CORE_NAV_ITEMS
    : [...CORE_NAV_ITEMS.slice(0, 1), { href: '/onboarding', label: 'Onboarding' }, ...CORE_NAV_ITEMS.slice(1)];

  return (
    <header className="sticky top-0 z-40 border-b border-[#ead9ca] bg-[#fffaf5]/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="text-lg font-bold tracking-[0.18em] text-[#1d140d] uppercase">
          Steady AI
        </Link>

        <button
          type="button"
          className="rounded-full border border-[#d9c4af] px-3 py-2 text-sm text-[#4e4035] md:hidden"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls="top-nav-menu"
        >
          Menu
        </button>

        <div className="hidden items-center gap-3 md:flex">
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    active ? 'bg-[#1d140d] text-white' : 'text-[#4e4035] hover:bg-[#f3e7da]'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-full border border-[#d9c4af] px-4 py-2 text-sm text-[#4e4035]"
            >
              Sign out
            </button>
          ) : isGoogleAuthConfigured || isAppleAuthConfigured ? (
            <div className="flex items-center gap-2">
              {isGoogleAuthConfigured ? (
                <button
                  type="button"
                  onClick={() => {
                    void signInWithGoogle();
                  }}
                  disabled={isSigningInWithGoogle || isSigningInWithApple}
                  className="rounded-full bg-[#1d140d] px-4 py-2 text-sm text-white disabled:bg-[#ab9a8c]"
                >
                  {isSigningInWithGoogle ? 'Connecting...' : 'Google'}
                </button>
              ) : null}
              {isAppleAuthConfigured ? (
                <button
                  type="button"
                  onClick={() => {
                    void signInWithApple();
                  }}
                  disabled={isSigningInWithGoogle || isSigningInWithApple}
                  className="rounded-full border border-[#1d140d] bg-white px-4 py-2 text-sm text-[#1d140d] disabled:border-[#cab8a8] disabled:text-[#ab9a8c]"
                >
                  {isSigningInWithApple ? 'Connecting...' : 'Apple'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

      </div>

      {isOpen ? (
        <nav id="top-nav-menu" className="border-t border-[#ead9ca] bg-[#fffaf5] px-4 py-2 md:hidden">
          <div className="flex flex-col gap-1">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`rounded-full px-3 py-2 text-sm ${
                    active ? 'bg-[#1d140d] text-white' : 'text-[#4e4035] hover:bg-[#f3e7da]'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  logout();
                }}
                className="rounded-full px-3 py-2 text-left text-sm text-[#4e4035] hover:bg-[#f3e7da]"
              >
                Sign out
              </button>
            ) : isGoogleAuthConfigured || isAppleAuthConfigured ? (
              <>
                {isGoogleAuthConfigured ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      void signInWithGoogle();
                    }}
                    disabled={isSigningInWithGoogle || isSigningInWithApple}
                    className="rounded-full bg-[#1d140d] px-3 py-2 text-left text-sm text-white disabled:bg-[#ab9a8c]"
                  >
                    {isSigningInWithGoogle ? 'Connecting...' : 'Continue with Google'}
                  </button>
                ) : null}
                {isAppleAuthConfigured ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      void signInWithApple();
                    }}
                    disabled={isSigningInWithGoogle || isSigningInWithApple}
                    className="rounded-full border border-[#1d140d] px-3 py-2 text-left text-sm text-[#1d140d] disabled:border-[#cab8a8] disabled:text-[#ab9a8c]"
                  >
                    {isSigningInWithApple ? 'Connecting...' : 'Continue with Apple'}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
