'use client';

import { isSupabaseBrowserAuthConfigured } from '@/config/env';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

const AUTH_STORAGE_KEY = 'steadyai.jwt';
const DEV_USER_ID_STORAGE_KEY = 'steadyai.dev-user-id';

interface AuthContextValue {
  token: string | null;
  userId: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  isGoogleAuthConfigured: boolean;
  isAppleAuthConfigured: boolean;
  isPasswordAuthConfigured: boolean;
  isSigningInWithGoogle: boolean;
  isSigningInWithApple: boolean;
  isSigningInWithPassword: boolean;
  login: (jwt: string) => void;
  loginAsDevUser: (userId: string) => void;
  signInWithGoogle: (options?: { redirectTo?: string }) => Promise<void>;
  signInWithApple: (options?: { redirectTo?: string }) => Promise<void>;
  signInWithPassword: (email: string, password: string, options?: { redirectTo?: string }) => Promise<void>;
  setToken: (jwt: string | null) => void;
  logout: (options?: { redirectTo?: string }) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [userId, setUserIdState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSigningInWithGoogle, setIsSigningInWithGoogle] = useState(false);
  const [isSigningInWithApple, setIsSigningInWithApple] = useState(false);
  const [isSigningInWithPassword, setIsSigningInWithPassword] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const isGoogleAuthConfigured = isSupabaseBrowserAuthConfigured();
  const isAppleAuthConfigured = isGoogleAuthConfigured;
  const isPasswordAuthConfigured = isGoogleAuthConfigured;

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
    const storedUserId = window.localStorage.getItem(DEV_USER_ID_STORAGE_KEY);
    setTokenState(stored && stored.trim() ? stored : null);
    setUserIdState(storedUserId && storedUserId.trim() ? storedUserId : null);

    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setIsHydrated(true);
      return;
    }

    let active = true;

    const syncSession = (accessToken: string | null, nextUserId: string | null) => {
      if (!active) {
        return;
      }

      if (accessToken) {
        window.localStorage.setItem(AUTH_STORAGE_KEY, accessToken);
        setTokenState(accessToken);
      } else {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
        setTokenState(null);
      }

      if (nextUserId) {
        window.localStorage.removeItem(DEV_USER_ID_STORAGE_KEY);
        setUserIdState(nextUserId);
      }
    };

    void supabase.auth.getSession().then(({ data }) => {
      syncSession(data.session?.access_token ?? null, data.session?.user?.id ?? null);
      if (active) {
        setIsHydrated(true);
      }
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      syncSession(session?.access_token ?? null, session?.user?.id ?? null);
      if (active) {
        setIsHydrated(true);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_STORAGE_KEY) {
        const next = event.newValue && event.newValue.trim() ? event.newValue : null;
        setTokenState(next);
      }

      if (event.key === DEV_USER_ID_STORAGE_KEY) {
        const nextUserId = event.newValue && event.newValue.trim() ? event.newValue : null;
        setUserIdState(nextUserId);
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persistToken = useCallback((jwt: string | null) => {
    if (jwt && jwt.trim()) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, jwt.trim());
      setTokenState(jwt.trim());
      return;
    }

    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    setTokenState(null);
  }, []);

  const persistDevUserId = useCallback((nextUserId: string | null) => {
    if (nextUserId && nextUserId.trim()) {
      window.localStorage.setItem(DEV_USER_ID_STORAGE_KEY, nextUserId.trim());
      setUserIdState(nextUserId.trim());
      return;
    }

    window.localStorage.removeItem(DEV_USER_ID_STORAGE_KEY);
    setUserIdState(null);
  }, []);

  const login = useCallback(
    (jwt: string) => {
      persistToken(jwt);
    },
    [persistToken]
  );

  const loginAsDevUser = useCallback(
    (nextUserId: string) => {
      persistDevUserId(nextUserId);
    },
    [persistDevUserId]
  );

  const signInWithGoogle = useCallback(
    async (options?: { redirectTo?: string }) => {
      setIsSigningInWithGoogle(true);
      try {
        await signInWithOAuthProvider('google', pathname, options?.redirectTo);
      } finally {
        setIsSigningInWithGoogle(false);
      }
    },
    [pathname]
  );

  const signInWithApple = useCallback(
    async (options?: { redirectTo?: string }) => {
      setIsSigningInWithApple(true);
      try {
        await signInWithOAuthProvider('apple', pathname, options?.redirectTo);
      } finally {
        setIsSigningInWithApple(false);
      }
    },
    [pathname]
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string, options?: { redirectTo?: string }) => {
      const supabase = createBrowserSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.');
      }

      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password) {
        throw new Error('Email and password are required.');
      }

      setIsSigningInWithPassword(true);
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password
        });

        if (error) {
          throw error;
        }

        if (data.session?.access_token) {
          persistToken(data.session.access_token);
        }
        if (data.user?.id) {
          persistDevUserId(data.user.id);
        }

        const target = options?.redirectTo ?? pathname ?? '/';
        if (target) {
          router.replace(target);
        }
      } finally {
        setIsSigningInWithPassword(false);
      }
    },
    [pathname, persistDevUserId, persistToken, router]
  );

  const logout = useCallback(
    (options?: { redirectTo?: string }) => {
      const supabase = createBrowserSupabaseClient();
      if (supabase) {
        void supabase.auth.signOut();
      }
      persistToken(null);
      persistDevUserId(null);
      const target = options?.redirectTo ?? '/';
      if (pathname !== target) {
        router.replace(target);
      }
    },
    [pathname, persistDevUserId, persistToken, router]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      userId,
      isHydrated,
      isAuthenticated: Boolean(token || userId),
      isGoogleAuthConfigured,
      isAppleAuthConfigured,
      isPasswordAuthConfigured,
      isSigningInWithGoogle,
      isSigningInWithApple,
      isSigningInWithPassword,
      login,
      loginAsDevUser,
      signInWithGoogle,
      signInWithApple,
      signInWithPassword,
      setToken: persistToken,
      logout
    }),
    [
      isAppleAuthConfigured,
      isGoogleAuthConfigured,
      isHydrated,
      isPasswordAuthConfigured,
      isSigningInWithApple,
      isSigningInWithGoogle,
      isSigningInWithPassword,
      login,
      loginAsDevUser,
      logout,
      persistToken,
      signInWithApple,
      signInWithGoogle,
      signInWithPassword,
      token,
      userId
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function signInWithOAuthProvider(provider: 'google' | 'apple', pathname: string | null, redirectToOverride?: string): Promise<void> {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase browser auth is not configured.');
  }

  const redirectTo = new URL('/auth/callback', window.location.origin);
  const next = redirectToOverride || pathname || '/';
  if (next) {
    redirectTo.searchParams.set('next', next);
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: redirectTo.toString(),
      queryParams:
        provider === 'google'
          ? {
              access_type: 'offline',
              prompt: 'consent'
            }
          : undefined
    }
  });

  if (error) {
    throw error;
  }
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }

  return context;
}

export function useRequireAuth(options?: { redirectTo?: string }) {
  const { isHydrated, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isHydrated || isAuthenticated) {
      return;
    }

    const redirectBase = options?.redirectTo ?? '/';
    const next = pathname ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`${redirectBase}${next}`);
  }, [isAuthenticated, isHydrated, options?.redirectTo, pathname, router]);

  return {
    isHydrated,
    isAuthenticated,
    isAuthorized: isHydrated && isAuthenticated
  };
}
