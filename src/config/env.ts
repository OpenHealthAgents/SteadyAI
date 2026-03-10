import dotenv from 'dotenv';

dotenv.config();

type NodeEnv = 'development' | 'test' | 'production';

interface AppEnv {
  NODE_ENV: NodeEnv;
  PORT: number;
  HOST: string;
  DATABASE_URL: string;
  DIRECT_URL: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_STORAGE_BUCKET: string;
  NUTRITION_AI_PROVIDER: 'gemini' | 'groq';
  LLM_PROVIDER: 'openai' | 'gemini' | 'groq';
  LLM_TIMEOUT_MS: number;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  GROQ_API_KEY: string;
  GROQ_MODEL: string;
  APPS_MCP_API_KEY: string;
  PUBLIC_BASE_URL: string;
}

function getNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'test' || value === 'production') {
    return value;
  }
  return 'development';
}

function getPort(value: string | undefined): number {
  const parsed = Number(value ?? '3000');
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('PORT must be a positive number');
  }
  return parsed;
}

function getPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export const env: AppEnv = {
  NODE_ENV: getNodeEnv(process.env.NODE_ENV),
  PORT: getPort(process.env.PORT),
  HOST: process.env.HOST ?? '0.0.0.0',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  DIRECT_URL: process.env.DIRECT_URL ?? '',
  SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET ?? 'nutrition-images',
  NUTRITION_AI_PROVIDER: process.env.NUTRITION_AI_PROVIDER === 'groq' ? 'groq' : 'gemini',
  LLM_PROVIDER:
    process.env.LLM_PROVIDER === 'openai' || process.env.LLM_PROVIDER === 'groq' ? process.env.LLM_PROVIDER : 'gemini',
  LLM_TIMEOUT_MS: getPositiveNumber(process.env.LLM_TIMEOUT_MS, 15000),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
  GROQ_API_KEY: process.env.GROQ_API_KEY ?? '',
  GROQ_MODEL: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
  APPS_MCP_API_KEY: process.env.APPS_MCP_API_KEY ?? '',
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? ''
  OPENAI_APPS_CHALLENGE_TOKEN: process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? ''
};
