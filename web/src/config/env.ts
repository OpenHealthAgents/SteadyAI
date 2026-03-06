const SERVER_FALLBACK_URL = 'http://localhost:3000';

export function getApiBaseUrl(isServer: boolean): string {
  if (isServer) {
    return process.env.STEADY_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || SERVER_FALLBACK_URL;
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL || SERVER_FALLBACK_URL;
}

export function isSupabaseBrowserAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
