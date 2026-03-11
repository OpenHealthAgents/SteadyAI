import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import { env } from '../config/env';
import { getPrismaClient } from '../db/prisma';
import { NutritionInputType, PostType } from '@prisma/client';
import type { BuildMcpUserSummaryInput } from '../mcp/userSummary';
import { createCommunityPost } from '../services/community-post.service';
import { generateAgentChatReply, type AgentChatType } from '../services/agent-chat.service';
import { generateEducatorLesson, generateMythCorrection } from '../services/educator.service';
import { generateMcpUserSummary } from '../services/mcp-user-summary.service';
import { estimateNutrition } from '../services/nutrition-ai.service';
import { ingestNutrition } from '../services/nutrition.service';
import {
  getLatestWorkoutSessionInsight,
  getWorkoutHistorySummary,
  getWorkoutPreferences,
  logWorkoutSessionSummary,
  upsertWorkoutPreferences
} from '../services/workout-session.service';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface ToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    openWorldHint?: boolean;
    destructiveHint?: boolean;
  };
  _meta?: Record<string, unknown>;
}

interface WorkoutExercise {
  name: string;
  durationMin: number;
  reps: string;
  gifUrl: string;
  note: string;
}

interface WorkoutPlan {
  planId: string;
  title: string;
  focus: string;
  estimatedTotalMin: number;
  exercises: WorkoutExercise[];
}

interface WeeklyInsight {
  headline: string;
  suggestion: string;
}

interface McpAuthContext {
  mode: 'service-key' | 'user-token' | 'none';
  userId: string | null;
  userEmail: string | null;
}

const SERVER_INFO = {
  name: 'steadyai-mcp',
  version: '1.0.0'
};

const AGENT_WIDGET_TEMPLATE_URI = 'ui://widget/steadyai-agent-card.html';
const EDUCATOR_WIDGET_TEMPLATE_URI = 'ui://widget/steadyai-educator-card.html';
const SUMMARY_WIDGET_TEMPLATE_URI = 'ui://widget/steadyai-summary-card.html';
const WORKOUT_WIDGET_TEMPLATE_URI = 'ui://widget/steadyai-workout-card.html';
const NUTRITION_WIDGET_TEMPLATE_URI = 'ui://widget/steadyai-nutrition-card-v3.html';
const MCP_SESSION_COOKIE = 'steadyai_mcp_session';
const SUPABASE_FLOW_COOKIE = 'steadyai_supabase_flow';
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const MCP_SESSION_TTL_MS = 60 * 60 * 1000;
const SUPABASE_FLOW_TTL_MS = 10 * 60 * 1000;

interface OAuthAuthorizeQuerystring {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

interface OAuthStartQuerystring {
  provider?: string;
  return_to?: string;
}

interface OAuthCallbackQuerystring {
  code?: string;
  flow?: string;
  error?: string;
  error_description?: string;
}

interface OAuthTokenBody {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  code_verifier?: string;
  refresh_token?: string;
}

interface PendingSupabaseFlow {
  id: string;
  provider: 'google' | 'apple';
  returnTo: string;
  codeVerifier: string;
  createdAt: number;
  expiresAt: number;
}

interface McpOAuthSession {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  userId: string;
  userEmail: string | null;
  createdAt: number;
  expiresAt: number;
}

interface McpAuthorizationCode {
  code: string;
  sessionId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  createdAt: number;
  expiresAt: number;
}

const pendingSupabaseFlows = new Map<string, PendingSupabaseFlow>();
const mcpOAuthSessions = new Map<string, McpOAuthSession>();
const mcpAuthorizationCodes = new Map<string, McpAuthorizationCode>();

function getPublicBaseUrl(): string {
  return env.PUBLIC_BASE_URL.replace(/\/+$/, '');
}

function getPublicMcpUrl(): string {
  const baseUrl = getPublicBaseUrl();
  return baseUrl ? `${baseUrl}/mcp` : '/mcp';
}

function getOAuthIssuer(): string {
  return getPublicBaseUrl() || `http://127.0.0.1:${env.PORT}`;
}

function getOAuthAuthorizeUrl(): string {
  return `${getOAuthIssuer()}/oauth/authorize`;
}

function getOAuthTokenUrl(): string {
  return `${getOAuthIssuer()}/oauth/token`;
}

function getOAuthProtectedResourceUrl(): string {
  return `${getOAuthIssuer()}/.well-known/oauth-protected-resource`;
}

function getSupabaseAuthBaseUrl(): string {
  return `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
}

function hasSupabaseOAuthSupport(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && getPublicBaseUrl());
}

const TOOLS: ToolDescriptor[] = [
  {
    name: 'steadyai.get_user_summary',
    title: 'Get User Summary',
    description:
      'Create a concise MCP-safe user summary from profile, engagement, and purchase inputs (without raw health data).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['profile'],
      properties: {
        profile: { type: 'object' },
        challengeActivity: { type: 'object' },
        communityEngagement: { type: 'object' },
        purchaseHistory: { type: 'object' }
      }
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    },
    _meta: {
      ui: {
        resourceUri: SUMMARY_WIDGET_TEMPLATE_URI,
        visibility: ['model', 'app']
      },
      'openai/outputTemplate': SUMMARY_WIDGET_TEMPLATE_URI,
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Building summary...',
      'openai/toolInvocation/invoked': 'Summary ready'
    }
  },
  {
    name: 'steadyai.ask_agent',
    title: 'SteadyAI Coach',
    description:
      'Primary coaching tool. Use this for meal planning, habit reset/check-in recovery, and community engagement guidance.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentType', 'prompt'],
      properties: {
        agentType: { type: 'string', enum: ['MEAL_PLANNER', 'HABIT_COACH', 'COMMUNITY_GUIDE'] },
        prompt: { type: 'string', minLength: 1 }
      }
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false
    },
    _meta: {
      ui: {
        resourceUri: AGENT_WIDGET_TEMPLATE_URI,
        visibility: ['model', 'app']
      },
      'openai/outputTemplate': AGENT_WIDGET_TEMPLATE_URI,
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Generating guidance...',
      'openai/toolInvocation/invoked': 'Guidance ready',
      usageHints: {
        whenToUse: [
          'User asks for a reset plan after missed check-ins',
          'User asks for a meal plan, grocery planning, or nutrition routine',
          'User asks for post ideas, outreach ideas, or community participation support'
        ],
        routing: {
          HABIT_COACH: ['reset', 'missed check-ins', 'consistency', 'routine', 'habit'],
          MEAL_PLANNER: ['meal', 'grocery', 'nutrition', 'protein', 'plan'],
          COMMUNITY_GUIDE: ['community', 'post', 'engagement', 'peer', 'reply']
        }
      }
    }
  },
  {
    name: 'steadyai.educator_help',
    title: 'Educator Help',
    description:
      'Generate either an educational lesson or a non-confrontational myth correction with context and citations.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        userQuestion: { type: 'string' },
        threadContext: { type: 'string' },
        communityPostText: { type: 'string' }
      }
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false
    },
    _meta: {
      ui: {
        resourceUri: EDUCATOR_WIDGET_TEMPLATE_URI,
        visibility: ['model', 'app']
      },
      'openai/outputTemplate': EDUCATOR_WIDGET_TEMPLATE_URI,
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Preparing educator response...',
      'openai/toolInvocation/invoked': 'Educator response ready'
    }
  },
  {
    name: 'steadyai.workout_coach',
    title: 'Personalized Workout Coach',
    description:
      "Generate today's personalized workout with exercise GIFs. Use this when users ask to create or modify today's routine.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', minLength: 1 },
        userId: { type: 'string' },
        currentPlan: { type: 'object' }
      }
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    },
    _meta: {
      ui: {
        resourceUri: WORKOUT_WIDGET_TEMPLATE_URI,
        visibility: ['model', 'app']
      },
      'openai/outputTemplate': WORKOUT_WIDGET_TEMPLATE_URI,
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Building today\'s workout...',
      'openai/toolInvocation/invoked': 'Workout ready'
    }
  },
  {
    name: 'steadyai.log_workout_session',
    title: 'Log Workout Session',
    description: 'Persist completed workout session summary for a user.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['userId', 'sessionId', 'totalDurationMinutes', 'completedExercises', 'totalExercises'],
      properties: {
        userId: { type: 'string', minLength: 1 },
        sessionId: { type: 'string', minLength: 1 },
        startedAt: { type: 'string' },
        completedAt: { type: 'string' },
        totalDurationMinutes: { type: 'number', minimum: 0 },
        completedExercises: { type: 'number', minimum: 0 },
        totalExercises: { type: 'number', minimum: 0 },
        workoutPlan: { type: 'object' },
        feedback: { type: 'string', enum: ['TOO_EASY', 'JUST_RIGHT', 'TOO_HARD'] }
      }
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false
    },
    _meta: {
      'openai/toolInvocation/invoking': 'Saving workout session...',
      'openai/toolInvocation/invoked': 'Workout session saved'
    }
  },
  {
    name: 'steadyai.get_current_user_context',
    title: 'Get Current User Context',
    description:
      'Returns current user context for tools/widgets. If userId is provided, validates it; otherwise resolves a recent onboarded user.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        userId: { type: 'string' }
      }
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    },
    _meta: {
      'openai/toolInvocation/invoking': 'Resolving user context...',
      'openai/toolInvocation/invoked': 'User context ready'
    }
  },
  {
    name: 'steadyai.generate_checkin_draft',
    title: 'Generate Check-In Draft',
    description: 'Generate a community CHECK_IN draft from workout session stats and weekly insights.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['totalDurationMinutes', 'completedExercises', 'totalExercises'],
      properties: {
        totalDurationMinutes: { type: 'number', minimum: 0 },
        completedExercises: { type: 'number', minimum: 0 },
        totalExercises: { type: 'number', minimum: 0 },
        feedback: { type: 'string', enum: ['TOO_EASY', 'JUST_RIGHT', 'TOO_HARD'] },
        weeklyInsight: { type: 'object' }
      }
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    },
    _meta: {
      'openai/toolInvocation/invoking': 'Generating check-in draft...',
      'openai/toolInvocation/invoked': 'Check-in draft ready'
    }
  },
  {
    name: 'steadyai.create_checkin_post',
    title: 'Create CHECK_IN Post',
    description: 'Publish a CHECK_IN community post from draft content.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['content'],
      properties: {
        userId: { type: 'string' },
        content: { type: 'string', minLength: 1 }
      }
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false
    },
    _meta: {
      'openai/toolInvocation/invoking': 'Publishing CHECK_IN post...',
      'openai/toolInvocation/invoked': 'CHECK_IN post created'
    }
  },
  {
    name: 'steadyai.update_workout_preferences',
    title: 'Update Workout Preferences',
    description: 'Save workout personalization preferences (duration, impact, equipment, auto-post check-in).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        userId: { type: 'string' },
        preferredDurationMinutes: { type: 'number', minimum: 5, maximum: 90 },
        preferredImpact: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        equipment: { type: 'string', enum: ['NONE', 'HOME', 'GYM'] },
        autoPostCheckIn: { type: 'boolean' }
      }
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false
    },
    _meta: {
      'openai/toolInvocation/invoking': 'Saving workout preferences...',
      'openai/toolInvocation/invoked': 'Workout preferences saved'
    }
  },
  {
    name: 'steadyai.nutrition_coach',
    title: 'Nutrition Coach',
    description:
      'Analyze a meal and return the interactive calorie and macro tracker card with quick adjustment and logging actions.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['mealText'],
      properties: {
        userId: { type: 'string' },
        mealText: { type: 'string', minLength: 1 },
        action: { type: 'string', enum: ['DEFAULT', 'LIGHTER', 'HIGH_PROTEIN', 'BALANCED', 'SWAP_CARB'] }
      }
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false
    },
    _meta: {
      ui: {
        resourceUri: NUTRITION_WIDGET_TEMPLATE_URI,
        visibility: ['model', 'app']
      },
      'openai/outputTemplate': NUTRITION_WIDGET_TEMPLATE_URI,
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Analyzing nutrition...',
      'openai/toolInvocation/invoked': 'Nutrition guidance ready'
    }
  },
  {
    name: 'steadyai.log_nutrition_intake',
    title: 'Log Nutrition Intake',
    description: 'Log a nutrition entry for the current user and return the updated interactive calorie tracker card.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['mealText'],
      properties: {
        userId: { type: 'string' },
        mealText: { type: 'string', minLength: 1 },
        consumedAt: { type: 'string' }
      }
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false
    },
    _meta: {
      ui: {
        resourceUri: NUTRITION_WIDGET_TEMPLATE_URI,
        visibility: ['model', 'app']
      },
      'openai/outputTemplate': NUTRITION_WIDGET_TEMPLATE_URI,
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Logging nutrition...',
      'openai/toolInvocation/invoked': 'Nutrition logged'
    }
  }
];

const WIDGET_RESOURCES = [
  {
    uri: AGENT_WIDGET_TEMPLATE_URI,
    name: 'SteadyAI Agent Card',
    description: 'Interactive card for agent responses with quick follow-up actions.',
    mimeType: 'text/html;profile=mcp-app'
  },
  {
    uri: EDUCATOR_WIDGET_TEMPLATE_URI,
    name: 'SteadyAI Educator Card',
    description: 'Interactive educational card with context and citations.',
    mimeType: 'text/html;profile=mcp-app'
  },
  {
    uri: SUMMARY_WIDGET_TEMPLATE_URI,
    name: 'SteadyAI Summary Card',
    description: 'Interactive user summary card with compact metrics.',
    mimeType: 'text/html;profile=mcp-app'
  },
  {
    uri: WORKOUT_WIDGET_TEMPLATE_URI,
    name: 'SteadyAI Workout Card',
    description: "Interactive workout card showing today's exercises with GIFs.",
    mimeType: 'text/html;profile=mcp-app'
  },
  {
    uri: NUTRITION_WIDGET_TEMPLATE_URI,
    name: 'SteadyAI Nutrition Card',
    description: 'Interactive nutrition coaching card with macro breakdown and quick adjustment actions.',
    mimeType: 'text/html;profile=mcp-app'
  }
];

const AGENT_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SteadyAI Agent Card</title>
    <style>
      :root {
        color-scheme: light dark;
        --border: color-mix(in oklab, canvasText 18%, transparent);
        --muted: color-mix(in oklab, canvasText 64%, transparent);
        --surface: color-mix(in oklab, canvas 95%, canvasText 5%);
      }
      body {
        margin: 0;
        font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: canvasText;
        background: transparent;
      }
      .card {
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px;
        background: var(--surface);
        display: grid;
        gap: 10px;
      }
      .title {
        margin: 0;
        font-size: 13px;
        color: var(--muted);
      }
      .body {
        margin: 0;
        font-size: 14px;
        white-space: pre-wrap;
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .action-block {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px;
        display: grid;
        gap: 6px;
      }
      .action-title {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
      }
      .action-help {
        margin: 0;
        font-size: 12px;
        color: var(--muted);
      }
      .button-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      button {
        border: 1px solid var(--border);
        background: canvas;
        color: canvasText;
        border-radius: 10px;
        padding: 8px 10px;
        font: inherit;
        cursor: pointer;
      }
      .primary {
        background: canvasText;
        color: canvas;
      }
      .meta {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <p id="agent" class="title">SteadyAI Agent</p>
      <p id="text" class="body">Loading response...</p>
      <div class="actions">
        <button id="simplify" class="primary">Make simpler</button>
        <button id="weekly">7-day version</button>
        <button id="expand">Expand</button>
      </div>
      <p id="status" class="meta"></p>
    </main>
    <script>
      const openaiHost = window.openai;
      const textEl = document.getElementById("text");
      const agentEl = document.getElementById("agent");
      const statusEl = document.getElementById("status");
      const simplifyBtn = document.getElementById("simplify");
      const weeklyBtn = document.getElementById("weekly");
      const expandBtn = document.getElementById("expand");

      function currentToolOutput() {
        return openaiHost?.toolOutput || {};
      }

      function currentToolInput() {
        return openaiHost?.toolInput || {};
      }

      function render() {
        const output = currentToolOutput();
        const input = currentToolInput();
        const responseText = typeof output?.text === "string" ? output.text : "No response available.";
        const agentType = typeof input?.agentType === "string" ? input.agentType : "AGENT";
        textEl.textContent = responseText;
        agentEl.textContent = "SteadyAI " + agentType.replaceAll("_", " ");
      }

      async function askFollowUp(instruction) {
        if (!openaiHost?.sendFollowUpMessage) {
          statusEl.textContent = "Follow-up actions are unavailable in this client.";
          return;
        }
        const input = currentToolInput();
        const basePrompt = typeof input?.prompt === "string" ? input.prompt : "";
        const nextPrompt = basePrompt ? basePrompt + " " + instruction : instruction;
        statusEl.textContent = "Sending follow-up...";
        await openaiHost.sendFollowUpMessage({ prompt: nextPrompt, scrollToBottom: true });
        statusEl.textContent = "Follow-up sent.";
      }

      simplifyBtn.addEventListener("click", () => askFollowUp("Please make this simpler and shorter."));
      weeklyBtn.addEventListener("click", () => askFollowUp("Turn this into a practical 7-day plan."));
      expandBtn.addEventListener("click", async () => {
        if (!openaiHost?.requestDisplayMode) {
          statusEl.textContent = "Expand mode is unavailable in this client.";
          return;
        }
        await openaiHost.requestDisplayMode({ mode: "fullscreen" });
      });

      window.addEventListener(
        "openai:set_globals",
        () => {
          render();
        },
        { passive: true }
      );

      render();
    </script>
  </body>
</html>`;

const EDUCATOR_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SteadyAI Educator Card</title>
    <style>
      :root { color-scheme: light dark; --border: color-mix(in oklab, canvasText 20%, transparent); --muted: color-mix(in oklab, canvasText 64%, transparent); }
      body { margin: 0; font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: transparent; color: canvasText; }
      .card { border: 1px solid var(--border); border-radius: 14px; padding: 12px; display: grid; gap: 10px; }
      .title { margin: 0; font-size: 13px; color: var(--muted); }
      .body { margin: 0; white-space: pre-wrap; }
      .chips { display: flex; gap: 8px; flex-wrap: wrap; }
      .chip { border: 1px solid var(--border); border-radius: 10px; background: canvas; color: canvasText; padding: 6px 9px; font: inherit; cursor: pointer; }
      ul { margin: 0; padding-left: 18px; }
      a { color: inherit; }
    </style>
  </head>
  <body>
    <main class="card">
      <p id="mode" class="title">SteadyAI Educator</p>
      <p id="text" class="body">Loading...</p>
      <div id="citationsWrap" hidden>
        <p class="title">Citations</p>
        <ul id="citations"></ul>
      </div>
      <div class="chips">
        <button id="clarify" class="chip">Explain simpler</button>
        <button id="expand" class="chip">Expand</button>
      </div>
    </main>
    <script>
      const openaiHost = window.openai;
      const modeEl = document.getElementById("mode");
      const textEl = document.getElementById("text");
      const citationsWrap = document.getElementById("citationsWrap");
      const citationsEl = document.getElementById("citations");
      const clarifyBtn = document.getElementById("clarify");
      const expandBtn = document.getElementById("expand");

      function render() {
        const output = openaiHost?.toolOutput || {};
        const mode = output?.mode === "myth-correction" ? "Myth Correction" : "Lesson";
        modeEl.textContent = "SteadyAI Educator - " + mode;
        const text = output?.suggestedCorrection || output?.lesson || "No educator output available.";
        textEl.textContent = text;

        const citations = Array.isArray(output?.citations) ? output.citations : [];
        citationsEl.innerHTML = "";
        citationsWrap.hidden = citations.length === 0;
        citations.forEach((item) => {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = typeof item?.url === "string" ? item.url : "#";
          a.textContent = typeof item?.title === "string" ? item.title : "Reference";
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          li.appendChild(a);
          citationsEl.appendChild(li);
        });
      }

      async function sendFollowUp(text) {
        if (!openaiHost?.sendFollowUpMessage) return;
        await openaiHost.sendFollowUpMessage({ prompt: text, scrollToBottom: true });
      }

      clarifyBtn.addEventListener("click", () => sendFollowUp("Please explain this in simpler language for a beginner."));
      expandBtn.addEventListener("click", async () => {
        if (!openaiHost?.requestDisplayMode) return;
        await openaiHost.requestDisplayMode({ mode: "fullscreen" });
      });

      window.addEventListener("openai:set_globals", render, { passive: true });
      render();
    </script>
  </body>
</html>`;

const SUMMARY_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SteadyAI Summary Card</title>
    <style>
      :root { color-scheme: light dark; --border: color-mix(in oklab, canvasText 20%, transparent); --muted: color-mix(in oklab, canvasText 64%, transparent); }
      body { margin: 0; font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: transparent; color: canvasText; }
      .card { border: 1px solid var(--border); border-radius: 14px; padding: 12px; display: grid; gap: 10px; }
      .title { margin: 0; font-size: 13px; color: var(--muted); }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .tile { border: 1px solid var(--border); border-radius: 10px; padding: 8px; }
      .k { margin: 0; font-size: 11px; color: var(--muted); }
      .v { margin: 3px 0 0; font-size: 16px; font-weight: 600; }
      button { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; background: canvas; color: canvasText; font: inherit; cursor: pointer; }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="title">SteadyAI User Summary</p>
      <div class="grid">
        <article class="tile"><p class="k">Check-ins</p><p id="checkins" class="v">0</p></article>
        <article class="tile"><p class="k">Completion Rate</p><p id="rate" class="v">0%</p></article>
        <article class="tile"><p class="k">Posts</p><p id="posts" class="v">0</p></article>
        <article class="tile"><p class="k">Total Purchases</p><p id="purchases" class="v">0</p></article>
      </div>
      <button id="expand">Expand full summary</button>
    </main>
    <script>
      const openaiHost = window.openai;
      const checkinsEl = document.getElementById("checkins");
      const rateEl = document.getElementById("rate");
      const postsEl = document.getElementById("posts");
      const purchasesEl = document.getElementById("purchases");
      const expandBtn = document.getElementById("expand");

      function render() {
        const output = openaiHost?.toolOutput || {};
        const checkins = Number(output?.challengeActivity?.checkIns?.total || 0);
        const rate = Number(output?.challengeActivity?.checkIns?.completionRate || 0);
        const posts = Number(output?.communityEngagement?.postsCount || 0);
        const purchases = Number(output?.purchaseHistory?.totalPurchases || 0);
        checkinsEl.textContent = String(checkins);
        rateEl.textContent = Math.round(rate * 100) + "%";
        postsEl.textContent = String(posts);
        purchasesEl.textContent = String(purchases);
      }

      expandBtn.addEventListener("click", async () => {
        if (!openaiHost?.requestDisplayMode) return;
        await openaiHost.requestDisplayMode({ mode: "fullscreen" });
      });

      window.addEventListener("openai:set_globals", render, { passive: true });
      render();
    </script>
  </body>
</html>`;

const WORKOUT_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SteadyAI Workout Coach</title>
    <style>
      :root {
        color-scheme: light dark;
        --border: color-mix(in oklab, canvasText 20%, transparent);
        --muted: color-mix(in oklab, canvasText 64%, transparent);
        --accent: color-mix(in oklab, canvasText 88%, transparent);
      }
      body {
        margin: 0;
        font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: transparent;
        color: canvasText;
      }
      .card {
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px;
        display: grid;
        gap: 10px;
      }
      .title {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }
      .meta {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }
      .session {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px;
        display: grid;
        gap: 6px;
      }
      .session-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
      }
      .timer {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
      }
      .session-controls {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .session-nav {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }
      .summary-item {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 6px;
      }
      .summary-item .k {
        margin: 0;
        color: var(--muted);
        font-size: 11px;
      }
      .summary-item .v {
        margin: 2px 0 0;
        font-size: 15px;
        font-weight: 700;
      }
      .history {
        border: 1px dashed var(--border);
        border-radius: 10px;
        padding: 8px;
        display: grid;
        gap: 4px;
      }
      .list {
        display: grid;
        gap: 8px;
      }
      .exercise {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px;
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 8px;
      }
      .exercise.done {
        border-color: color-mix(in oklab, limegreen 45%, var(--border));
      }
      .exercise.active {
        border-color: color-mix(in oklab, dodgerblue 50%, var(--border));
      }
      .thumb {
        width: 84px;
        height: 84px;
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: color-mix(in oklab, canvas 92%, canvasText 8%);
      }
      .exercise h4 {
        margin: 0;
        font-size: 13px;
      }
      .exercise p {
        margin: 0;
        font-size: 12px;
        color: var(--muted);
      }
      .exercise-controls {
        margin-top: 6px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      button {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 7px 9px;
        background: canvas;
        color: canvasText;
        font: inherit;
        cursor: pointer;
      }
      .primary {
        background: var(--accent);
        color: canvas;
      }
      .pill {
        border-radius: 999px;
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <p id="title" class="title">Today's Workout</p>
      <p id="focus" class="meta"></p>
      <section class="summary">
        <article class="summary-item"><p class="k">Total</p><p id="totalMin" class="v">0 min</p></article>
        <article class="summary-item"><p class="k">Exercises</p><p id="count" class="v">0</p></article>
        <article class="summary-item"><p class="k">Done</p><p id="doneCount" class="v">0</p></article>
      </section>
      <section class="history">
        <p class="action-title">Last 7 Days</p>
        <p id="historyText" class="meta">No recent sessions yet.</p>
      </section>
      <section class="history">
        <p class="action-title">Weekly Insight</p>
        <p id="weeklyInsightHeadline" class="meta">No weekly insight yet.</p>
        <p id="weeklyInsightSuggestion" class="meta"></p>
      </section>
      <section class="session">
        <div class="session-head">
          <p id="timerLabel" class="meta">Session idle</p>
          <p id="timerClock" class="timer">00:00</p>
        </div>
        <div class="session-controls">
          <button id="startSession" class="primary">Start session</button>
          <button id="pauseSession">Pause</button>
          <button id="resetSession">Reset</button>
        </div>
        <div class="session-nav">
          <button id="prevExercise">Previous</button>
          <button id="nextExercise">Next</button>
          <p id="sessionStep" class="meta">Exercise 1/1</p>
        </div>
      </section>
      <section id="list" class="list"></section>
      <section class="action-block">
        <p class="action-title">Adjust Today&apos;s Routine</p>
        <p class="action-help">Use these to regenerate your current workout style.</p>
        <div class="button-row">
          <button id="easier" class="primary">Make easier</button>
          <button id="harder">Make harder</button>
          <button id="swap" class="pill">No-impact swap all</button>
        </div>
      </section>
      <section class="action-block">
        <p class="action-title">Save and Rate This Session</p>
        <p class="action-help">Save first, then give feedback so tomorrow&apos;s plan auto-adjusts.</p>
        <div class="button-row">
          <button id="saveSession">Save session</button>
          <button id="fbTooEasy">Too easy</button>
          <button id="fbJustRight">Just right</button>
          <button id="fbTooHard">Too hard</button>
        </div>
      </section>
      <section class="action-block">
        <p class="action-title">Workout Preferences</p>
        <p class="action-help">Remember your defaults for future plans.</p>
        <div class="button-row">
          <label class="meta">Duration
            <input id="prefDuration" type="number" min="5" max="90" step="1" style="margin-left:6px;width:72px;" />
          </label>
          <label class="meta">Impact
            <select id="prefImpact" style="margin-left:6px;">
              <option value="">Default</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>
          <label class="meta">Equipment
            <select id="prefEquipment" style="margin-left:6px;">
              <option value="">Default</option>
              <option value="NONE">None</option>
              <option value="HOME">Home</option>
              <option value="GYM">Gym</option>
            </select>
          </label>
          <label class="meta">
            <input id="prefAutoPost" type="checkbox" />
            Auto-post CHECK_IN
          </label>
          <button id="savePrefs">Save preferences</button>
          <button id="resetPrefs">Reset to defaults</button>
        </div>
        <p id="prefsUpdated" class="meta">Preferences last updated: never</p>
      </section>
      <section class="action-block">
        <p class="action-title">CHECK_IN Draft</p>
        <p class="action-help">Auto-generated after save. You can post this in community.</p>
        <textarea id="checkinDraft" rows="4" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px;background:canvas;color:canvasText;" placeholder="No draft generated yet."></textarea>
        <div class="button-row">
          <button id="postCheckin">Create CHECK_IN post</button>
        </div>
      </section>
      <p id="saveBadge" class="meta" hidden>Duplicate save prevented.</p>
      <p id="status" class="meta"></p>
    </main>
    <script>
      const openaiHost = window.openai;
      const titleEl = document.getElementById("title");
      const focusEl = document.getElementById("focus");
      const listEl = document.getElementById("list");
      const totalMinEl = document.getElementById("totalMin");
      const countEl = document.getElementById("count");
      const doneCountEl = document.getElementById("doneCount");
      const historyTextEl = document.getElementById("historyText");
      const weeklyInsightHeadlineEl = document.getElementById("weeklyInsightHeadline");
      const weeklyInsightSuggestionEl = document.getElementById("weeklyInsightSuggestion");
      const checkinDraftEl = document.getElementById("checkinDraft");
      const postCheckinBtn = document.getElementById("postCheckin");
      const saveBadgeEl = document.getElementById("saveBadge");
      const statusEl = document.getElementById("status");
      const timerLabelEl = document.getElementById("timerLabel");
      const timerClockEl = document.getElementById("timerClock");
      const startSessionBtn = document.getElementById("startSession");
      const pauseSessionBtn = document.getElementById("pauseSession");
      const resetSessionBtn = document.getElementById("resetSession");
      const prevExerciseBtn = document.getElementById("prevExercise");
      const nextExerciseBtn = document.getElementById("nextExercise");
      const sessionStepEl = document.getElementById("sessionStep");
      const easierBtn = document.getElementById("easier");
      const harderBtn = document.getElementById("harder");
      const swapBtn = document.getElementById("swap");
      const saveSessionBtn = document.getElementById("saveSession");
      const fbTooEasyBtn = document.getElementById("fbTooEasy");
      const fbJustRightBtn = document.getElementById("fbJustRight");
      const fbTooHardBtn = document.getElementById("fbTooHard");
      const prefDurationEl = document.getElementById("prefDuration");
      const prefImpactEl = document.getElementById("prefImpact");
      const prefEquipmentEl = document.getElementById("prefEquipment");
      const prefAutoPostEl = document.getElementById("prefAutoPost");
      const savePrefsBtn = document.getElementById("savePrefs");
      const resetPrefsBtn = document.getElementById("resetPrefs");
      const prefsUpdatedEl = document.getElementById("prefsUpdated");
      let timerHandle = null;

      function safeState() {
        return openaiHost?.widgetState || {};
      }

      function completedMap() {
        return safeState().completedByIndex || {};
      }

      function sessionState() {
        return safeState().session || {
          running: false,
          mode: "exercise",
          activeIndex: 0,
          remainingSec: 0
        };
      }

      function planFromOutput() {
        const output = openaiHost?.toolOutput || {};
        return output?.plan || null;
      }

      function historyFromOutput() {
        const output = openaiHost?.toolOutput || {};
        return output?.history7d || null;
      }

      function weeklyInsightFromOutput() {
        const output = openaiHost?.toolOutput || {};
        return output?.weeklyInsight || null;
      }

      function preferencesFromOutput() {
        const output = openaiHost?.toolOutput || {};
        return output?.preferences || null;
      }

      function formatDateTime(value) {
        if (!value) return "never";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "never";
        return date.toLocaleString();
      }

      function userIdFromOutput() {
        const output = openaiHost?.toolOutput || {};
        return typeof output?.userId === "string" ? output.userId : null;
      }

      async function resolveUserId() {
        const existing = safeState().userId || userIdFromOutput();
        if (existing) {
          return existing;
        }

        try {
          if (openaiHost?.callTool) {
            const result = await openaiHost.callTool("steadyai.get_current_user_context", {});
            const resolved = result?.structuredContent?.userId || result?.userId || null;
            if (typeof resolved === "string" && resolved) {
              await persist({ userId: resolved });
              return resolved;
            }
          }
        } catch {
          return null;
        }

        return null;
      }

      async function saveSession(feedbackValue) {
        const plan = currentPlan();
        const completedByIndex = completedMap();
        const done = (Array.isArray(plan?.exercises) ? plan.exercises : []).reduce((n, _, i) => n + (completedByIndex[i] ? 1 : 0), 0);
        const totalExercises = Array.isArray(plan?.exercises) ? plan.exercises.length : 0;
        const userId = await resolveUserId();
        if (!userId) {
          statusEl.textContent = "Session not saved: no user context found yet.";
          return false;
        }

        const feedback = feedbackValue || safeState().feedback || null;
        const args = {
          userId,
          sessionId: (plan?.planId || "workout-session") + "-session",
          totalDurationMinutes: Number(plan?.estimatedTotalMin || 0),
          completedExercises: done,
          totalExercises,
          workoutPlan: plan || {},
          feedback
        };

        const signature = JSON.stringify({
          sessionId: args.sessionId,
          totalDurationMinutes: args.totalDurationMinutes,
          completedExercises: args.completedExercises,
          totalExercises: args.totalExercises,
          feedback: args.feedback || null
        });
        const now = Date.now();
        const priorSig = safeState().lastSavedSignature;
        const priorAt = Number(safeState().lastSavedAtMs || 0);
        if (priorSig === signature && now - priorAt < 10000) {
          statusEl.textContent = "Already saved. Try again after a few seconds if you made changes.";
          saveBadgeEl.hidden = false;
          saveBadgeEl.textContent = "Duplicate save prevented (same payload within 10 seconds).";
          return false;
        }
        saveBadgeEl.hidden = true;
        saveBadgeEl.textContent = "";

        await persist({ feedback: feedback || null });

        try {
          if (openaiHost?.callTool) {
            statusEl.textContent = "Saving session...";
            const result = await openaiHost.callTool("steadyai.log_workout_session", args);
            await persist({ lastSavedSignature: signature, lastSavedAtMs: now });
            const deduped = Boolean(result?.structuredContent?.deduplicated);
            if (deduped) {
              saveBadgeEl.hidden = false;
              saveBadgeEl.textContent = "Duplicate save prevented by backend idempotency.";
              statusEl.textContent = "No new save needed.";
            } else {
              saveBadgeEl.hidden = true;
              saveBadgeEl.textContent = "";
              statusEl.textContent = "Session saved.";
            }
            const weeklyInsight = weeklyInsightFromOutput();
            try {
              const draftResult = await openaiHost.callTool("steadyai.generate_checkin_draft", {
                totalDurationMinutes: args.totalDurationMinutes,
                completedExercises: args.completedExercises,
                totalExercises: args.totalExercises,
                feedback: args.feedback || undefined,
                weeklyInsight: weeklyInsight || undefined
              });
              const draftText = draftResult?.structuredContent?.content || draftResult?.content?.[0]?.text || "";
              if (typeof draftText === "string" && draftText.trim()) {
                checkinDraftEl.value = draftText;
                await persist({ checkInDraft: draftText });
                const autoPost = Boolean(prefAutoPostEl.checked || safeState().preferences?.autoPostCheckIn);
                if (autoPost) {
                  await createCheckInPostFromDraft();
                }
              }
            } catch {
              // ignore draft generation failures and keep save success
            }
            return true;
          }
        } catch {
          statusEl.textContent = "Direct save unavailable; using follow-up request.";
        }

        if (!openaiHost?.sendFollowUpMessage) {
          statusEl.textContent = "Could not save session in this client.";
          return false;
        }

        const prompt = "Use steadyai.log_workout_session with " + JSON.stringify(args);
        await openaiHost.sendFollowUpMessage({ prompt, scrollToBottom: true });
        await persist({ lastSavedSignature: signature, lastSavedAtMs: now });
        const fallbackDraftPrompt =
          "Use steadyai.generate_checkin_draft with " +
          JSON.stringify({
            totalDurationMinutes: args.totalDurationMinutes,
            completedExercises: args.completedExercises,
            totalExercises: args.totalExercises,
            feedback: args.feedback || undefined,
            weeklyInsight: weeklyInsightFromOutput() || undefined
          });
        await openaiHost.sendFollowUpMessage({ prompt: fallbackDraftPrompt, scrollToBottom: true });
        return true;
      }

      async function createCheckInPostFromDraft() {
        const content = (checkinDraftEl.value || "").trim();
        if (!content) {
          statusEl.textContent = "No CHECK_IN draft to post yet.";
          return;
        }

        const userId = await resolveUserId();
        if (!userId) {
          statusEl.textContent = "Cannot post: no user context found.";
          return;
        }

        if (openaiHost?.callTool) {
          try {
            statusEl.textContent = "Publishing CHECK_IN post...";
            await openaiHost.callTool("steadyai.create_checkin_post", {
              userId,
              content
            });
            statusEl.textContent = "CHECK_IN post created.";
            await persist({ lastCheckInPostedAt: new Date().toISOString() });
            return;
          } catch (error) {
            statusEl.textContent = "Could not create post. Join an active challenge/community first.";
            return;
          }
        }

        if (openaiHost?.sendFollowUpMessage) {
          const prompt = "Use steadyai.create_checkin_post with " + JSON.stringify({ userId, content });
          await openaiHost.sendFollowUpMessage({ prompt, scrollToBottom: true });
          statusEl.textContent = "Sent post request.";
          return;
        }

        statusEl.textContent = "Post action unavailable in this client.";
      }

      async function savePreferences() {
        const userId = await resolveUserId();
        if (!userId) {
          statusEl.textContent = "Cannot save preferences: no user context found.";
          return;
        }
        if (!openaiHost?.callTool) {
          statusEl.textContent = "Preference save unavailable in this client.";
          return;
        }
        const args = {
          userId,
          preferredDurationMinutes: prefDurationEl.value ? Number(prefDurationEl.value) : undefined,
          preferredImpact: prefImpactEl.value || undefined,
          equipment: prefEquipmentEl.value || undefined,
          autoPostCheckIn: Boolean(prefAutoPostEl.checked)
        };
        try {
          statusEl.textContent = "Saving preferences...";
          const result = await openaiHost.callTool("steadyai.update_workout_preferences", args);
          const prefs = result?.structuredContent || {};
          await persist({
            preferences: {
              preferredDurationMinutes: prefs.preferredDurationMinutes ?? args.preferredDurationMinutes ?? null,
              preferredImpact: prefs.preferredImpact ?? args.preferredImpact ?? null,
              equipment: prefs.equipment ?? args.equipment ?? null,
              autoPostCheckIn: typeof prefs.autoPostCheckIn === "boolean" ? prefs.autoPostCheckIn : args.autoPostCheckIn,
              updatedAt: typeof prefs.updatedAt === "string" ? prefs.updatedAt : new Date().toISOString()
            }
          });
          statusEl.textContent = "Preferences saved.";
        } catch {
          statusEl.textContent = "Could not save preferences.";
        }
      }

      async function resetPreferences() {
        prefDurationEl.value = "";
        prefImpactEl.value = "";
        prefEquipmentEl.value = "";
        prefAutoPostEl.checked = false;
        await savePreferences();
      }

      function planFromState() {
        return safeState().plan || null;
      }

      function currentPlan() {
        return planFromState() || planFromOutput();
      }

      async function persist(partial) {
        if (!openaiHost?.setWidgetState) return;
        await openaiHost.setWidgetState({
          ...safeState(),
          ...partial
        });
      }

      function asTwoDigits(value) {
        return String(Math.max(0, value)).padStart(2, "0");
      }

      function formatClock(totalSec) {
        const sec = Math.max(0, Number(totalSec) || 0);
        const mm = Math.floor(sec / 60);
        const ss = sec % 60;
        return asTwoDigits(mm) + ":" + asTwoDigits(ss);
      }

      function defaultExerciseSeconds(exercise) {
        const min = Number(exercise?.durationMin || 0);
        return Math.max(30, Math.round(min * 60));
      }

      function ensureSession(plan) {
        const state = sessionState();
        const exercises = Array.isArray(plan?.exercises) ? plan.exercises : [];
        if (!exercises.length) {
          return {
            running: false,
            mode: "exercise",
            activeIndex: 0,
            remainingSec: 0
          };
        }

        if (typeof state.remainingSec === "number" && state.remainingSec > 0) {
          return state;
        }

        return {
          running: false,
          mode: "exercise",
          activeIndex: 0,
          remainingSec: defaultExerciseSeconds(exercises[0])
        };
      }

      async function tickSession() {
        const plan = currentPlan();
        const exercises = Array.isArray(plan?.exercises) ? plan.exercises : [];
        if (!exercises.length) return;

        const state = sessionState();
        if (!state.running) return;

        const nextRemaining = Math.max(0, Number(state.remainingSec || 0) - 1);
        let next = { ...state, remainingSec: nextRemaining };

        if (nextRemaining === 0) {
          if (state.mode === "exercise") {
            const complete = { ...completedMap(), [state.activeIndex]: true };
            await persist({ completedByIndex: complete });
            next = {
              ...next,
              mode: "rest",
              remainingSec: 20
            };
          } else {
            const nextIndex = state.activeIndex + 1;
            if (nextIndex >= exercises.length) {
              next = {
                ...next,
                running: false,
                mode: "complete",
                remainingSec: 0
              };
            } else {
              next = {
                ...next,
                mode: "exercise",
                activeIndex: nextIndex,
                remainingSec: defaultExerciseSeconds(exercises[nextIndex])
              };
            }
          }
        }

        await persist({ session: next });
        render();
      }

      function stopTimerLoop() {
        if (timerHandle) {
          clearInterval(timerHandle);
          timerHandle = null;
        }
      }

      function startTimerLoop() {
        stopTimerLoop();
        timerHandle = setInterval(() => {
          void tickSession();
        }, 1000);
      }

      function optimisticModifyExercise(plan, index, kind) {
        const clone = JSON.parse(JSON.stringify(plan));
        const ex = clone.exercises?.[index];
        if (!ex) return clone;
        if (kind === "easier") {
          ex.note = "Adjusted easier: lower impact and shorter effort blocks.";
        }
        if (kind === "harder") {
          ex.note = "Adjusted harder: increased challenge and effort density.";
        }
        if (kind === "swap") {
          ex.name = ex.name + " (Swap)";
          ex.note = "Swapped to a low-impact alternative.";
        }
        return clone;
      }

      function render() {
        const plan = currentPlan();
        const completed = completedMap();
        if (!plan) {
          titleEl.textContent = "Today's Workout";
          focusEl.textContent = "No workout plan yet.";
          totalMinEl.textContent = "0 min";
          countEl.textContent = "0";
          doneCountEl.textContent = "0";
          historyTextEl.textContent = "No recent sessions yet.";
          weeklyInsightHeadlineEl.textContent = "No weekly insight yet.";
          weeklyInsightSuggestionEl.textContent = "";
          checkinDraftEl.value = safeState().checkInDraft || "";
          postCheckinBtn.disabled = !checkinDraftEl.value.trim();
          const prefs = safeState().preferences || preferencesFromOutput() || {};
          prefDurationEl.value = prefs.preferredDurationMinutes ? String(prefs.preferredDurationMinutes) : "";
          prefImpactEl.value = prefs.preferredImpact || "";
          prefEquipmentEl.value = prefs.equipment || "";
          prefAutoPostEl.checked = Boolean(prefs.autoPostCheckIn);
          prefsUpdatedEl.textContent = "Preferences last updated: " + formatDateTime(prefs.updatedAt);
          listEl.innerHTML = "";
          return;
        }

        const exercises = Array.isArray(plan.exercises) ? plan.exercises : [];
        const done = exercises.reduce((n, _, i) => n + (completed[i] ? 1 : 0), 0);
        const session = ensureSession(plan);
        titleEl.textContent = plan.title || "Today's Workout";
        focusEl.textContent = (plan.focus || "General fitness") + " • " + (plan.estimatedTotalMin || 0) + " min";
        totalMinEl.textContent = (plan.estimatedTotalMin || 0) + " min";
        countEl.textContent = String(exercises.length);
        doneCountEl.textContent = String(done);
        const history = historyFromOutput();
        if (history && typeof history.sessions === "number") {
          const rate = Math.round(Number(history.avgCompletionRate || 0) * 100);
          const mins = Math.round(Number(history.avgDurationMinutes || 0));
          const streak = Number(history.streakDays || 0);
          const feedback = typeof history.lastFeedback === "string" ? history.lastFeedback.replaceAll("_", " ").toLowerCase() : "n/a";
          historyTextEl.textContent =
            String(history.sessions) + " sessions • avg " + rate + "% completion • " +
            mins + " min avg • streak " + streak + " day(s) • last feedback: " + feedback;
        } else {
          historyTextEl.textContent = "No recent sessions yet.";
        }
        const weekly = weeklyInsightFromOutput();
        const prefs = safeState().preferences || preferencesFromOutput() || {};
        prefDurationEl.value = prefs.preferredDurationMinutes ? String(prefs.preferredDurationMinutes) : "";
        prefImpactEl.value = prefs.preferredImpact || "";
        prefEquipmentEl.value = prefs.equipment || "";
        prefAutoPostEl.checked = Boolean(prefs.autoPostCheckIn);
        prefsUpdatedEl.textContent = "Preferences last updated: " + formatDateTime(prefs.updatedAt);
        if (weekly && typeof weekly.headline === "string") {
          weeklyInsightHeadlineEl.textContent = weekly.headline;
          weeklyInsightSuggestionEl.textContent = typeof weekly.suggestion === "string" ? weekly.suggestion : "";
        } else {
          weeklyInsightHeadlineEl.textContent = "No weekly insight yet.";
          weeklyInsightSuggestionEl.textContent = "";
        }
        checkinDraftEl.value = safeState().checkInDraft || "";
        postCheckinBtn.disabled = !checkinDraftEl.value.trim();

        if (session.mode === "complete") {
          timerLabelEl.textContent = "Session complete";
          timerClockEl.textContent = "00:00";
          sessionStepEl.textContent = "Complete";
          prevExerciseBtn.disabled = true;
          nextExerciseBtn.disabled = true;
        } else {
          const activeName = exercises[session.activeIndex]?.name || "Workout";
          timerLabelEl.textContent =
            session.mode === "rest"
              ? "Rest before " + activeName
              : "Now: " + activeName;
          timerClockEl.textContent = formatClock(session.remainingSec);
          sessionStepEl.textContent =
            "Exercise " + String(Math.min(session.activeIndex + 1, exercises.length)) + "/" + String(exercises.length);
          prevExerciseBtn.disabled = session.activeIndex <= 0;
          nextExerciseBtn.disabled = session.activeIndex >= exercises.length - 1;
        }

        if (session.running) {
          startTimerLoop();
        } else {
          stopTimerLoop();
        }

        listEl.innerHTML = "";
        exercises.forEach((ex, index) => {
          const doneState = Boolean(completed[index]);
          const card = document.createElement("article");
          const active = index === session.activeIndex && session.mode !== "complete";
          card.className = "exercise" + (doneState ? " done" : "") + (active ? " active" : "");

          const img = document.createElement("img");
          img.className = "thumb";
          img.src = ex.gifUrl || "";
          img.alt = (ex.name || "Exercise") + " demo";
          img.loading = "lazy";

          const content = document.createElement("div");
          const name = document.createElement("h4");
          name.textContent = (index + 1) + ". " + (ex.name || "Exercise");
          const details = document.createElement("p");
          details.textContent = (ex.reps || "") + " • " + (ex.durationMin || 0) + " min";
          const note = document.createElement("p");
          note.textContent = ex.note || "";
          const gif = document.createElement("a");
          gif.href = ex.gifUrl || "#";
          gif.target = "_blank";
          gif.rel = "noopener noreferrer";
          gif.textContent = "Open GIF";

          const controls = document.createElement("div");
          controls.className = "exercise-controls";
          const doneBtn = document.createElement("button");
          doneBtn.textContent = doneState ? "Undo done" : "Mark done";
          const easier = document.createElement("button");
          easier.textContent = "Easier";
          const harder = document.createElement("button");
          harder.textContent = "Harder";
          const swap = document.createElement("button");
          swap.textContent = "Swap";

          doneBtn.addEventListener("click", async () => {
            const next = { ...completedMap(), [index]: !doneState };
            await persist({ completedByIndex: next });
            render();
          });

          easier.addEventListener("click", async () => await requestExerciseUpdate(index, ex.name, "easier"));
          harder.addEventListener("click", async () => await requestExerciseUpdate(index, ex.name, "harder"));
          swap.addEventListener("click", async () => await requestExerciseUpdate(index, ex.name, "swap"));

          controls.appendChild(doneBtn);
          controls.appendChild(easier);
          controls.appendChild(harder);
          controls.appendChild(swap);
          content.appendChild(name);
          content.appendChild(details);
          content.appendChild(note);
          content.appendChild(gif);
          content.appendChild(controls);
          card.appendChild(img);
          card.appendChild(content);
          listEl.appendChild(card);
        });
      }

      async function requestExerciseUpdate(index, exerciseName, mode) {
        const plan = currentPlan();
        if (!plan) return;
        const nextPlan = optimisticModifyExercise(plan, index, mode);
        await persist({
          plan: nextPlan,
          lastInstruction: mode + ":" + exerciseName
        });
        render();

        if (!openaiHost?.sendFollowUpMessage) {
          statusEl.textContent = "Saved locally. Follow-up calls are unavailable in this client.";
          return;
        }

        statusEl.textContent = "Requesting updated routine...";
        const instruction =
          mode === "swap"
            ? "Swap this exercise for a safer alternative"
            : mode === "easier"
              ? "Make this exercise easier"
              : "Make this exercise harder";

        const prompt =
          "Use steadyai.workout_coach to modify today's routine. " +
          "Instruction: " + instruction +
          ". Exercise index: " + (index + 1) +
          ". Exercise name: " + exerciseName + ".";

        await openaiHost.sendFollowUpMessage({ prompt, scrollToBottom: true });
      }

      async function askModify(instruction) {
        if (!openaiHost?.sendFollowUpMessage) {
          statusEl.textContent = "Follow-up not available in this client.";
          return;
        }
        await persist({
          plan: currentPlan(),
          lastInstruction: instruction
        });
        statusEl.textContent = "Requesting update...";
        const prompt = "Use steadyai.workout_coach to modify today's routine. Instruction: " + instruction;
        await openaiHost.sendFollowUpMessage({ prompt, scrollToBottom: true });
      }

      easierBtn.addEventListener("click", () => askModify("Reduce impact and keep total duration near 20 minutes."));
      harderBtn.addEventListener("click", () => askModify("Increase challenge with one advanced movement and optional finisher."));
      swapBtn.addEventListener("click", () => askModify("Replace jumping movements with knee-friendly no-impact alternatives."));
      saveSessionBtn.addEventListener("click", async () => {
        await saveSession(null);
      });
      fbTooEasyBtn.addEventListener("click", async () => { await saveSession("TOO_EASY"); });
      fbJustRightBtn.addEventListener("click", async () => { await saveSession("JUST_RIGHT"); });
      fbTooHardBtn.addEventListener("click", async () => { await saveSession("TOO_HARD"); });
      postCheckinBtn.addEventListener("click", async () => { await createCheckInPostFromDraft(); });
      savePrefsBtn.addEventListener("click", async () => { await savePreferences(); });
      resetPrefsBtn.addEventListener("click", async () => { await resetPreferences(); });

      startSessionBtn.addEventListener("click", async () => {
        const plan = currentPlan();
        if (!plan) return;
        const next = {
          ...ensureSession(plan),
          running: true
        };
        await persist({ session: next });
        render();
      });

      pauseSessionBtn.addEventListener("click", async () => {
        const plan = currentPlan();
        if (!plan) return;
        const next = {
          ...ensureSession(plan),
          running: false
        };
        await persist({ session: next });
        render();
      });

      resetSessionBtn.addEventListener("click", async () => {
        const plan = currentPlan();
        const exercises = Array.isArray(plan?.exercises) ? plan.exercises : [];
        const remainingSec = exercises.length ? defaultExerciseSeconds(exercises[0]) : 0;
        await persist({
          session: {
            running: false,
            mode: "exercise",
            activeIndex: 0,
            remainingSec
          },
          completedByIndex: {}
        });
        render();
      });

      prevExerciseBtn.addEventListener("click", async () => {
        const plan = currentPlan();
        const exercises = Array.isArray(plan?.exercises) ? plan.exercises : [];
        if (!exercises.length) return;
        const state = ensureSession(plan);
        const nextIndex = Math.max(0, state.activeIndex - 1);
        await persist({
          session: {
            running: false,
            mode: "exercise",
            activeIndex: nextIndex,
            remainingSec: defaultExerciseSeconds(exercises[nextIndex])
          }
        });
        render();
      });

      nextExerciseBtn.addEventListener("click", async () => {
        const plan = currentPlan();
        const exercises = Array.isArray(plan?.exercises) ? plan.exercises : [];
        if (!exercises.length) return;
        const state = ensureSession(plan);
        const nextIndex = Math.min(exercises.length - 1, state.activeIndex + 1);
        await persist({
          session: {
            running: false,
            mode: "exercise",
            activeIndex: nextIndex,
            remainingSec: defaultExerciseSeconds(exercises[nextIndex])
          }
        });
        render();
      });

      window.addEventListener("openai:set_globals", async () => {
        const outputPlan = planFromOutput();
        const statePlan = planFromState();
        const outputPrefs = preferencesFromOutput();
        if (outputPlan && outputPlan.planId !== statePlan?.planId && openaiHost?.setWidgetState) {
          const remainingSec = defaultExerciseSeconds((outputPlan.exercises || [])[0]);
          await persist({
            plan: outputPlan,
            userId: userIdFromOutput() || safeState().userId || null,
            preferences: outputPrefs || safeState().preferences || null,
            session: {
              running: false,
              mode: "exercise",
              activeIndex: 0,
              remainingSec
            }
          });
        } else if (outputPrefs && openaiHost?.setWidgetState) {
          await persist({
            preferences: outputPrefs
          });
        }
        render();
      }, { passive: true });

      render();
    </script>
  </body>
</html>`;

const NUTRITION_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SteadyAI Nutrition Coach</title>
    <style>
      :root { color-scheme: light dark; --border: color-mix(in oklab, canvasText 20%, transparent); --muted: color-mix(in oklab, canvasText 60%, transparent); }
      body { margin: 0; font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: transparent; color: canvasText; }
      .card { border: 1px solid var(--border); border-radius: 14px; padding: 12px; display: grid; gap: 10px; }
      .title { margin: 0; font-size: 15px; font-weight: 700; }
      .muted { margin: 0; color: var(--muted); font-size: 12px; }
      .stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 6px; }
      .tile { border: 1px solid var(--border); border-radius: 10px; padding: 8px; }
      .k { margin: 0; color: var(--muted); font-size: 11px; }
      .v { margin: 3px 0 0; font-size: 16px; font-weight: 700; }
      .today { border: 1px dashed var(--border); border-radius: 10px; padding: 8px; }
      ul { margin: 0; padding-left: 18px; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      button { border: 1px solid var(--border); border-radius: 10px; padding: 7px 9px; background: canvas; color: canvasText; font: inherit; cursor: pointer; }
      .primary { background: canvasText; color: canvas; }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="title">Nutrition Coach</p>
      <p id="subtitle" class="muted">Meal analysis</p>
      <section class="stats">
        <article class="tile"><p class="k">Calories</p><p id="cal" class="v">0</p></article>
        <article class="tile"><p class="k">Protein</p><p id="pro" class="v">0g</p></article>
        <article class="tile"><p class="k">Carbs</p><p id="carb" class="v">0g</p></article>
        <article class="tile"><p class="k">Fat</p><p id="fat" class="v">0g</p></article>
      </section>
      <section class="today">
        <p class="k">Today so far</p>
        <p id="today" class="v">0 kcal · 0 entries</p>
      </section>
      <p class="muted">Suggestions</p>
      <ul id="tips"></ul>
      <div class="actions">
        <button id="log" class="primary">Log this meal</button>
        <button id="lighter">Make it lighter</button>
        <button id="protein">Higher protein</button>
        <button id="balanced">Balanced plate</button>
        <button id="swap">Swap carb source</button>
      </div>
      <p id="status" class="muted"></p>
    </main>
    <script>
      const openaiHost = window.openai;
      const subtitleEl = document.getElementById("subtitle");
      const calEl = document.getElementById("cal");
      const proEl = document.getElementById("pro");
      const carbEl = document.getElementById("carb");
      const fatEl = document.getElementById("fat");
      const todayEl = document.getElementById("today");
      const tipsEl = document.getElementById("tips");
      const statusEl = document.getElementById("status");
      const logBtn = document.getElementById("log");
      const lighterBtn = document.getElementById("lighter");
      const proteinBtn = document.getElementById("protein");
      const balancedBtn = document.getElementById("balanced");
      const swapBtn = document.getElementById("swap");

      function output() {
        return openaiHost?.toolOutput || {};
      }

      function input() {
        return openaiHost?.toolInput || {};
      }

      function safeState() {
        return openaiHost?.widgetState || {};
      }

      async function persist(partial) {
        if (!openaiHost?.setWidgetState) return;
        await openaiHost.setWidgetState({
          ...safeState(),
          ...partial
        });
      }

      async function resolveUserId() {
        const outUserId = typeof output()?.userId === "string" ? output().userId : "";
        const stateUserId = typeof safeState()?.userId === "string" ? safeState().userId : "";
        const existing = outUserId || stateUserId;
        if (existing) return existing;
        if (!openaiHost?.callTool) return null;
        try {
          const result = await openaiHost.callTool("steadyai.get_current_user_context", {});
          const resolved = result?.structuredContent?.userId || result?.userId || null;
          if (typeof resolved === "string" && resolved) {
            await persist({ userId: resolved });
            return resolved;
          }
        } catch {
          return null;
        }
        return null;
      }

      function render() {
        const out = output();
        const totals = out?.totals || {};
        const mealText = typeof out?.mealText === "string" ? out.mealText : (typeof input()?.mealText === "string" ? input().mealText : "Meal");
        subtitleEl.textContent = mealText.slice(0, 120);
        calEl.textContent = String(Math.round(Number(totals.calories || 0)));
        proEl.textContent = String(Math.round(Number(totals.proteinG || 0))) + "g";
        carbEl.textContent = String(Math.round(Number(totals.carbsG || 0))) + "g";
        fatEl.textContent = String(Math.round(Number(totals.fatG || 0))) + "g";
        const tips = Array.isArray(out?.tips) ? out.tips : [];
        tipsEl.innerHTML = "";
        tips.forEach((tip) => {
          const li = document.createElement("li");
          li.textContent = String(tip);
          tipsEl.appendChild(li);
        });
        const today = out?.todaySummary || safeState()?.todaySummary || {};
        const cals = Math.round(Number(today?.calories || 0));
        const entries = Math.round(Number(today?.entries || 0));
        todayEl.textContent = cals + " kcal · " + entries + " entr" + (entries === 1 ? "y" : "ies");
      }

      async function sendAction(action) {
        if (!openaiHost?.sendFollowUpMessage) {
          statusEl.textContent = "Quick actions unavailable in this client.";
          return;
        }
        const baseMeal = typeof input()?.mealText === "string" ? input().mealText : "";
        const userId = typeof output()?.userId === "string" ? output().userId : "";
        const payload = { mealText: baseMeal, action };
        if (userId) payload.userId = userId;
        const prompt = "Use steadyai.nutrition_coach with " + JSON.stringify(payload);
        statusEl.textContent = "Requesting update...";
        await openaiHost.sendFollowUpMessage({ prompt, scrollToBottom: true });
      }

      async function logMeal() {
        const mealText = typeof output()?.mealText === "string" ? output().mealText : (typeof input()?.mealText === "string" ? input().mealText : "");
        if (!mealText.trim()) {
          statusEl.textContent = "Meal text is missing.";
          return;
        }

        const userId = await resolveUserId();
        if (!userId) {
          statusEl.textContent = "Log unavailable: no user context found.";
          return;
        }

        if (!openaiHost?.callTool) {
          if (openaiHost?.sendFollowUpMessage) {
            const prompt = "Use steadyai.log_nutrition_intake with " + JSON.stringify({ userId, mealText });
            statusEl.textContent = "Submitting log request...";
            await openaiHost.sendFollowUpMessage({ prompt, scrollToBottom: true });
            return;
          }
          statusEl.textContent = "Log action unavailable in this client.";
          return;
        }

        try {
          statusEl.textContent = "Logging meal...";
          const result = await openaiHost.callTool("steadyai.log_nutrition_intake", { userId, mealText });
          const updatedToday = result?.structuredContent?.todaySummary || null;
          if (updatedToday) {
            await persist({ todaySummary: updatedToday, userId });
          }
          render();
          statusEl.textContent = "Meal logged.";
        } catch (error) {
          statusEl.textContent = "Could not log meal.";
        }
      }

      logBtn.addEventListener("click", logMeal);
      lighterBtn.addEventListener("click", () => sendAction("LIGHTER"));
      proteinBtn.addEventListener("click", () => sendAction("HIGH_PROTEIN"));
      balancedBtn.addEventListener("click", () => sendAction("BALANCED"));
      swapBtn.addEventListener("click", () => sendAction("SWAP_CARB"));
      window.addEventListener("openai:set_globals", render, { passive: true });
      render();
    </script>
  </body>
</html>`;

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

type WorkoutAdjustment = 'easier' | 'harder' | 'neutral';

function buildWorkoutPlan(prompt: string, currentPlan?: WorkoutPlan, adjustment: WorkoutAdjustment = 'neutral'): WorkoutPlan {
  const normalized = prompt.toLowerCase();
  const kneeFriendly = /knee|no-impact|low impact/.test(normalized);
  const harder = /harder|advanced|intense/.test(normalized) || adjustment === 'harder';
  const easier = /easy|easier|beginner|recover/.test(normalized) || kneeFriendly || adjustment === 'easier';

  const base: WorkoutExercise[] = [
    {
      name: kneeFriendly ? 'March in Place' : 'Jumping Jacks',
      durationMin: easier ? 3 : 4,
      reps: easier ? 'steady pace' : '60 reps',
      gifUrl: kneeFriendly
        ? 'https://media.giphy.com/media/l0MYDGA3Du1hBR4xG/giphy.gif'
        : 'https://media.giphy.com/media/3o7TKtnuHOHHUjR38Y/giphy.gif',
      note: 'Warm-up to raise heart rate and prep joints.'
    },
    {
      name: kneeFriendly ? 'Bodyweight Box Squat' : 'Bodyweight Squat',
      durationMin: 4,
      reps: harder ? '4 x 15' : easier ? '3 x 10' : '3 x 12',
      gifUrl: 'https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif',
      note: 'Keep chest upright and push through heels.'
    },
    {
      name: harder ? 'Push-Up + Shoulder Tap' : 'Push-Up',
      durationMin: 4,
      reps: harder ? '4 x 10' : easier ? '3 x 6' : '3 x 8',
      gifUrl: 'https://media.giphy.com/media/xT0Gqz4x4eLd5gDtaU/giphy.gif',
      note: 'Use incline push-ups if needed.'
    },
    {
      name: kneeFriendly ? 'Glute Bridge' : 'Reverse Lunge',
      durationMin: 4,
      reps: harder ? '3 x 14/side' : easier ? '3 x 8/side' : '3 x 10/side',
      gifUrl: kneeFriendly
        ? 'https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif'
        : 'https://media.giphy.com/media/l0HlNQ03J5JxX6lva/giphy.gif',
      note: kneeFriendly ? 'Drive through heels and squeeze glutes.' : 'Keep front knee stable over mid-foot.'
    },
    {
      name: 'Forearm Plank',
      durationMin: easier ? 3 : 4,
      reps: harder ? '4 x 45 sec' : easier ? '3 x 20 sec' : '3 x 30 sec',
      gifUrl: 'https://media.giphy.com/media/26FPJGjhefSJuaRhu/giphy.gif',
      note: 'Brace core and keep hips level.'
    }
  ];

  if (harder) {
    base.push({
      name: 'Finisher: Mountain Climbers',
      durationMin: 3,
      reps: '3 rounds x 30 sec',
      gifUrl: 'https://media.giphy.com/media/3o6ZsVx5YQfFQ8kBHy/giphy.gif',
      note: 'Optional finisher for extra conditioning.'
    });
  }

  const estimatedTotalMin = base.reduce((sum, item) => sum + item.durationMin, 0);
  const focus = harder ? 'Strength + conditioning' : easier ? 'Low-impact consistency' : 'Full-body consistency';

  return {
    planId: randomId(currentPlan?.planId ? 'updated-plan' : 'plan'),
    title: "Today's Personalized Workout",
    focus,
    estimatedTotalMin,
    exercises: base
  };
}

function applyWorkoutPreferences(plan: WorkoutPlan, preferences: {
  preferredDurationMinutes?: number | null;
  preferredImpact?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  equipment?: 'NONE' | 'HOME' | 'GYM' | null;
} | null): WorkoutPlan {
  if (!preferences) {
    return plan;
  }
  const desired = typeof preferences.preferredDurationMinutes === 'number' ? preferences.preferredDurationMinutes : null;
  const impact = preferences.preferredImpact ?? null;
  const equipment = preferences.equipment ?? null;

  const clone: WorkoutPlan = {
    ...plan,
    exercises: plan.exercises.map((x) => ({ ...x }))
  };

  if (desired && clone.estimatedTotalMin > 0) {
    const ratio = Math.max(0.6, Math.min(1.6, desired / clone.estimatedTotalMin));
    clone.exercises = clone.exercises.map((x) => ({
      ...x,
      durationMin: Math.max(2, Math.round(x.durationMin * ratio))
    }));
    clone.estimatedTotalMin = clone.exercises.reduce((sum, item) => sum + item.durationMin, 0);
  }

  if (impact === 'LOW') {
    clone.focus = 'Low-impact consistency';
    clone.exercises = clone.exercises.map((x) =>
      x.name.toLowerCase().includes('jump')
        ? { ...x, name: x.name.replace(/Jumping Jacks/gi, 'March in Place'), note: 'Adjusted for lower impact.' }
        : x
    );
  }

  if (equipment === 'NONE') {
    clone.exercises = clone.exercises.map((x) => ({
      ...x,
      note: `${x.note} No equipment required.`
    }));
  }

  if (equipment === 'GYM') {
    clone.exercises = clone.exercises.map((x) => ({
      ...x,
      note: `${x.note} Optional gym variation available.`
    }));
  }

  return clone;
}

function buildWeeklyInsight(input: {
  sessions: number;
  avgCompletionRate: number;
  avgDurationMinutes: number;
  streakDays: number;
  lastFeedback: 'TOO_EASY' | 'JUST_RIGHT' | 'TOO_HARD' | null;
} | null): WeeklyInsight {
  if (!input || input.sessions === 0) {
    return {
      headline: 'No workout history yet this week.',
      suggestion: 'Complete one short session today and save it to start your weekly trend.'
    };
  }

  const ratePct = Math.round(input.avgCompletionRate * 100);
  const mins = Math.round(input.avgDurationMinutes);
  const feedbackHint =
    input.lastFeedback === 'TOO_HARD'
      ? 'you flagged recent training as too hard'
      : input.lastFeedback === 'TOO_EASY'
        ? 'you flagged recent training as too easy'
        : 'your recent feedback is balanced';

  const headline = `Weekly trend: ${input.sessions} sessions, ${ratePct}% average completion, ${mins} min average duration.`;
  let suggestion = 'Keep the current routine and focus on consistency through the week.';

  if (input.avgCompletionRate < 0.6 || input.lastFeedback === 'TOO_HARD') {
    suggestion = `Dial intensity down slightly since ${feedbackHint}. Keep sessions shorter and prioritize completion streaks.`;
  } else if (input.avgCompletionRate > 0.9 || input.lastFeedback === 'TOO_EASY') {
    suggestion = `Add one progression block since ${feedbackHint}. Increase one exercise challenge while keeping form strict.`;
  }

  if (input.streakDays >= 3) {
    suggestion = `Strong ${input.streakDays}-day streak. ${suggestion}`;
  }

  return { headline, suggestion };
}

function buildCheckInDraft(input: {
  totalDurationMinutes: number;
  completedExercises: number;
  totalExercises: number;
  feedback: 'TOO_EASY' | 'JUST_RIGHT' | 'TOO_HARD' | null;
  weeklyInsight?: WeeklyInsight;
}): string {
  const completionRate =
    input.totalExercises > 0 ? Math.round((input.completedExercises / input.totalExercises) * 100) : 0;
  const feedbackText =
    input.feedback === 'TOO_EASY'
      ? 'The session felt easier than expected.'
      : input.feedback === 'TOO_HARD'
        ? 'The session felt challenging and I need a lighter progression.'
        : 'The session felt about right.';
  const insightLine = input.weeklyInsight ? `Weekly insight: ${input.weeklyInsight.headline}` : '';

  return [
    `Workout CHECK_IN: Completed ${input.completedExercises}/${input.totalExercises} exercises in ${input.totalDurationMinutes} minutes (${completionRate}% completion).`,
    feedbackText,
    insightLine,
    'Next step: I will show up for the next session and keep building consistency.'
  ]
    .filter(Boolean)
    .join(' ');
}

type NutritionAction = 'DEFAULT' | 'LIGHTER' | 'HIGH_PROTEIN' | 'BALANCED' | 'SWAP_CARB';

function toNutritionAction(value: unknown): NutritionAction {
  if (value === 'LIGHTER' || value === 'HIGH_PROTEIN' || value === 'BALANCED' || value === 'SWAP_CARB') {
    return value;
  }
  return 'DEFAULT';
}

function buildNutritionTips(action: NutritionAction, totals: {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}): string[] {
  const tips: string[] = [];
  if (action === 'LIGHTER') {
    tips.push('Reduce dense sauces/oils first to cut calories without shrinking volume.');
    tips.push('Keep protein portion steady and replace part of starch with vegetables.');
  } else if (action === 'HIGH_PROTEIN') {
    tips.push('Add a lean protein side (Greek yogurt, tofu, chicken, fish, legumes).');
    tips.push('Target +20g protein while keeping calories similar by trimming refined carbs/fats.');
  } else if (action === 'BALANCED') {
    tips.push('Use a balanced plate: half vegetables, quarter protein, quarter carbs.');
    tips.push('Pair carbs with protein/fat to improve satiety and glucose response.');
  } else if (action === 'SWAP_CARB') {
    tips.push('Swap refined carbs for higher-fiber alternatives (brown rice, quinoa, beans, potatoes).');
    tips.push('Keep portion similar at first, then adjust based on hunger and goals.');
  } else {
    tips.push('Start with consistency: one sustainable meal improvement beats perfect plans.');
    tips.push('Log portions for 3 days to identify easy wins for calories and protein.');
  }

  if (totals.proteinG < 20) {
    tips.push('Protein looks low for this meal; consider adding a protein anchor.');
  }
  if (totals.calories > 800) {
    tips.push('Calories are on the higher side; portioning energy-dense items can help.');
  }
  return tips.slice(0, 4);
}

async function getNutritionSummaryToday(userId: string): Promise<{
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  entries: number;
}> {
  const prisma = getPrismaClient();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.nutritionEntry.findMany({
    where: {
      userId,
      consumedAt: { gte: start }
    },
    select: {
      totalCalories: true,
      totalProteinG: true,
      totalCarbsG: true,
      totalFatG: true
    }
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.calories += row.totalCalories ?? 0;
      acc.proteinG += Number(row.totalProteinG ?? 0);
      acc.carbsG += Number(row.totalCarbsG ?? 0);
      acc.fatG += Number(row.totalFatG ?? 0);
      return acc;
    },
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );

  return {
    ...totals,
    entries: rows.length
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isAgentType(value: unknown): value is AgentChatType {
  return value === 'MEAL_PLANNER' || value === 'HABIT_COACH' || value === 'COMMUNITY_GUIDE';
}

function ensureAuthorized(request: FastifyRequest, reply: FastifyReply): boolean {
  const serviceKey = env.APPS_MCP_API_KEY.trim();
  const auth = request.headers.authorization;
  if (!serviceKey && !auth) {
    return true;
  }
  if (!auth || !auth.startsWith('Bearer ')) {
    void reply.status(401).send({ error: 'Missing bearer token' });
    return false;
  }
  return true;
}

function sendOAuthChallenge(reply: FastifyReply): void {
  const resourceMetadata = getOAuthProtectedResourceUrl();
  reply.header('WWW-Authenticate', `Bearer realm="steadyai-mcp", resource_metadata="${resourceMetadata}"`);
  void reply.status(401).send({ error: 'Authentication required' });
}

function ensureMcpRequestAuthorized(request: FastifyRequest, reply: FastifyReply): boolean {
  const auth = request.headers.authorization;
  const serviceKey = env.APPS_MCP_API_KEY.trim();

  if (!auth) {
    if (hasSupabaseOAuthSupport()) {
      sendOAuthChallenge(reply);
      return false;
    }

    if (!serviceKey) {
      return true;
    }

    void reply.status(401).send({ error: 'Missing bearer token' });
    return false;
  }

  if (!auth.startsWith('Bearer ')) {
    if (hasSupabaseOAuthSupport()) {
      sendOAuthChallenge(reply);
      return false;
    }

    void reply.status(401).send({ error: 'Missing bearer token' });
    return false;
  }

  return true;
}

function getBearerToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }
  const token = auth.slice('Bearer '.length).trim();
  return token || null;
}

async function resolveUserFromSupabaseAccessToken(token: string): Promise<{ id: string; email?: string }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Supabase auth env is not configured');
  }

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_PUBLISHABLE_KEY
    }
  });

  if (!response.ok) {
    throw new Error('Invalid or expired user token');
  }

  const user = (await response.json()) as { id?: string; email?: string };
  if (!user.id) {
    throw new Error('User token missing id');
  }
  return { id: user.id, email: user.email };
}

async function exchangeSupabasePkceCode(authCode: string, codeVerifier: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
}> {
  const response = await fetch(`${getSupabaseAuthBaseUrl()}/token?grant_type=pkce`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_PUBLISHABLE_KEY
    },
    body: JSON.stringify({
      auth_code: authCode,
      code_verifier: codeVerifier
    })
  });

  if (!response.ok) {
    throw new Error('Failed to exchange Supabase PKCE code');
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    user?: { id?: string; email?: string };
  };
}

async function refreshSupabaseAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const response = await fetch(`${getSupabaseAuthBaseUrl()}/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_PUBLISHABLE_KEY
    },
    body: JSON.stringify({
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error('Failed to refresh Supabase access token');
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

function cleanupExpiredOAuthState(): void {
  const now = Date.now();

  for (const [id, flow] of pendingSupabaseFlows.entries()) {
    if (flow.expiresAt <= now) {
      pendingSupabaseFlows.delete(id);
    }
  }

  for (const [id, session] of mcpOAuthSessions.entries()) {
    if (session.expiresAt <= now) {
      mcpOAuthSessions.delete(id);
    }
  }

  for (const [code, authCode] of mcpAuthorizationCodes.entries()) {
    if (authCode.expiresAt <= now) {
      mcpAuthorizationCodes.delete(code);
    }
  }
}

function parseCookies(request: FastifyRequest): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) {
    return {};
  }

  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) {
      return acc;
    }
    acc[rawKey] = decodeURIComponent(rawValue.join('=') || '');
    return acc;
  }, {});
}

function appendSetCookie(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader('Set-Cookie');
  if (!existing) {
    reply.header('Set-Cookie', cookie);
    return;
  }
  if (Array.isArray(existing)) {
    reply.header('Set-Cookie', [...existing, cookie]);
    return;
  }
  reply.header('Set-Cookie', [String(existing), cookie]);
}

function serializeCookie(name: string, value: string, options?: { maxAgeSeconds?: number; path?: string; httpOnly?: boolean }): string {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options?.path ?? '/'}`);
  segments.push('SameSite=Lax');
  if (options?.httpOnly !== false) {
    segments.push('HttpOnly');
  }
  if (getOAuthIssuer().startsWith('https://')) {
    segments.push('Secure');
  }
  if (typeof options?.maxAgeSeconds === 'number') {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  return segments.join('; ');
}

function clearCookie(reply: FastifyReply, name: string): void {
  appendSetCookie(reply, serializeCookie(name, '', { maxAgeSeconds: 0 }));
}

function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') {
      return true;
    }
    return (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

function getAuthorizeQueryFromRequest(request: FastifyRequest<{ Querystring: OAuthAuthorizeQuerystring }>): OAuthAuthorizeQuerystring {
  return request.query ?? {};
}

function validateAuthorizeRequest(query: OAuthAuthorizeQuerystring): {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
} {
  if (query.response_type !== 'code') {
    throw new Error('response_type=code is required');
  }
  if (!query.client_id?.trim()) {
    throw new Error('client_id is required');
  }
  if (!query.redirect_uri?.trim() || !isSafeRedirectUri(query.redirect_uri)) {
    throw new Error('redirect_uri must be an absolute https URL or localhost URL');
  }
  if (!query.state?.trim()) {
    throw new Error('state is required');
  }
  if (!query.code_challenge?.trim()) {
    throw new Error('code_challenge is required');
  }
  if ((query.code_challenge_method || 'S256') !== 'S256') {
    throw new Error('code_challenge_method must be S256');
  }

  return {
    clientId: query.client_id.trim(),
    redirectUri: query.redirect_uri.trim(),
    state: query.state.trim(),
    scope: query.scope?.trim() || 'openid profile email',
    codeChallenge: query.code_challenge.trim(),
    codeChallengeMethod: 'S256'
  };
}

function buildAuthorizeReturnTo(query: OAuthAuthorizeQuerystring): string {
  const url = new URL('/oauth/authorize', getOAuthIssuer());
  Object.entries(query).forEach(([key, value]) => {
    if (typeof value === 'string' && value) {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function readMcpSession(request: FastifyRequest): McpOAuthSession | null {
  cleanupExpiredOAuthState();
  const cookies = parseCookies(request);
  const sessionId = cookies[MCP_SESSION_COOKIE];
  if (!sessionId) {
    return null;
  }

  const session = mcpOAuthSessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    mcpOAuthSessions.delete(sessionId);
    return null;
  }

  return session;
}

function setMcpSessionCookie(reply: FastifyReply, sessionId: string): void {
  appendSetCookie(reply, serializeCookie(MCP_SESSION_COOKIE, sessionId, { maxAgeSeconds: MCP_SESSION_TTL_MS / 1000 }));
}

function createMcpOAuthSession(input: {
  accessToken: string;
  refreshToken?: string | null;
  userId: string;
  userEmail?: string | null;
  expiresInSeconds?: number;
}): McpOAuthSession {
  cleanupExpiredOAuthState();
  const session: McpOAuthSession = {
    id: randomToken('mcp_session'),
    accessToken: input.accessToken,
    refreshToken: input.refreshToken ?? null,
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    createdAt: Date.now(),
    expiresAt: Date.now() + Math.max(60, input.expiresInSeconds ?? MCP_SESSION_TTL_MS / 1000) * 1000
  };
  mcpOAuthSessions.set(session.id, session);
  return session;
}

function createAuthorizationCode(input: {
  sessionId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}): McpAuthorizationCode {
  cleanupExpiredOAuthState();
  const code: McpAuthorizationCode = {
    code: randomToken('mcp_code'),
    sessionId: input.sessionId,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    scope: input.scope,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    createdAt: Date.now(),
    expiresAt: Date.now() + AUTH_CODE_TTL_MS
  };
  mcpAuthorizationCodes.set(code.code, code);
  return code;
}

function renderOAuthLoginPage(input: { authorizeUrl: string; error?: string | null }): string {
  const googleUrl = `/oauth/login?provider=google&return_to=${encodeURIComponent(input.authorizeUrl)}`;
  const appleUrl = `/oauth/login?provider=apple&return_to=${encodeURIComponent(input.authorizeUrl)}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect Steady AI</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #f4efe8; color: #1d140d; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      .card { max-width: 560px; width: 100%; background: rgba(255,250,245,.96); border: 1px solid #ead9ca; border-radius: 28px; padding: 32px; box-shadow: 0 24px 80px rgba(80,48,24,.08); }
      .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; color: #7a4b28; }
      h1 { margin: 12px 0 8px; font-size: 32px; }
      p { line-height: 1.7; color: #5f5145; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
      a { text-decoration: none; border-radius: 999px; padding: 14px 20px; font-weight: 600; }
      .primary { background: #1d140d; color: white; }
      .secondary { border: 1px solid #1d140d; color: #1d140d; background: white; }
      .error { margin-top: 16px; color: #b42318; }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="eyebrow">Steady AI for ChatGPT</div>
      <h1>Sign in to connect your coaching account</h1>
      <p>Choose a provider to connect Steady AI with ChatGPT. This lets ChatGPT access your workouts, nutrition logs, reports, and community context as you.</p>
      ${input.error ? `<p class="error">${input.error}</p>` : ''}
      <div class="actions">
        <a class="primary" href="${googleUrl}">Continue with Google</a>
        <a class="secondary" href="${appleUrl}">Continue with Apple</a>
      </div>
    </main>
  </body>
</html>`;
}

async function resolveMcpAuthContext(request: FastifyRequest): Promise<McpAuthContext> {
  const token = getBearerToken(request);
  if (!token) {
    const session = readMcpSession(request);
    if (session) {
      return {
        mode: 'user-token',
        userId: session.userId,
        userEmail: session.userEmail
      };
    }
    return { mode: 'none', userId: null, userEmail: null };
  }

  const serviceKey = env.APPS_MCP_API_KEY.trim();
  if (serviceKey && token === serviceKey) {
    const userHint = request.headers['x-steadyai-user-id'];
    return {
      mode: 'service-key',
      userId: typeof userHint === 'string' && userHint.trim() ? userHint.trim() : null,
      userEmail: null
    };
  }

  try {
    const user = await resolveUserFromSupabaseAccessToken(token);
    return {
      mode: 'user-token',
      userId: user.id,
      userEmail: user.email ?? null
    };
  } catch (error) {
    if (!serviceKey) {
      return { mode: 'none', userId: null, userEmail: null };
    }
    throw error;
  }
}

function sendJsonRpcResult(reply: FastifyReply, id: JsonRpcId, result: unknown): void {
  void reply.status(200).send({
    jsonrpc: '2.0',
    id: id ?? null,
    result
  });
}

function sendJsonRpcError(reply: FastifyReply, id: JsonRpcId, code: number, message: string): void {
  void reply.status(200).send({
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message
    }
  });
}

async function resolveUserContext(
  candidateUserId?: string,
  authenticatedUserId?: string | null
): Promise<{
  userId: string | null;
  source: 'provided' | 'authenticated-token' | 'recent-onboarded' | 'recent-any' | 'none';
}> {
  const prisma = getPrismaClient();
  const requested = candidateUserId?.trim();

  if (requested) {
    const existing = await prisma.user.findUnique({
      where: { id: requested },
      select: { id: true }
    });
    if (existing) {
      return { userId: existing.id, source: 'provided' };
    }
  }

  if (authenticatedUserId) {
    const authUser = await prisma.user.findUnique({
      where: { id: authenticatedUserId },
      select: { id: true }
    });
    if (authUser) {
      return { userId: authUser.id, source: 'authenticated-token' };
    }
  }

  const onboarded = await prisma.user.findFirst({
    where: { onboardingCompleted: true },
    orderBy: { updatedAt: 'desc' },
    select: { id: true }
  });
  if (onboarded) {
    return { userId: onboarded.id, source: 'recent-onboarded' };
  }

  const recentAny = await prisma.user.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { id: true }
  });
  if (recentAny) {
    return { userId: recentAny.id, source: 'recent-any' };
  }

  return { userId: null, source: 'none' };
}

async function handleToolCall(
  params: unknown,
  authContext: McpAuthContext
): Promise<{ text: string; data: unknown; meta?: Record<string, unknown> }> {
  const payload = asObject(params);
  const name = payload.name;
  const args = asObject(payload.arguments);

  if (typeof name !== 'string' || !name) {
    throw new Error('Tool name is required');
  }

  if (name === 'steadyai.get_user_summary') {
    if (!args.profile || typeof args.profile !== 'object') {
      throw new Error('profile is required');
    }

    const summary = generateMcpUserSummary({
      profile: args.profile as BuildMcpUserSummaryInput['profile'],
      challengeActivity:
        args.challengeActivity && typeof args.challengeActivity === 'object'
          ? (args.challengeActivity as BuildMcpUserSummaryInput['challengeActivity'])
          : undefined,
      communityEngagement:
        args.communityEngagement && typeof args.communityEngagement === 'object'
          ? (args.communityEngagement as BuildMcpUserSummaryInput['communityEngagement'])
          : undefined,
      purchaseHistory:
        args.purchaseHistory && typeof args.purchaseHistory === 'object'
          ? (args.purchaseHistory as BuildMcpUserSummaryInput['purchaseHistory'])
          : undefined
    });

    return {
      text: `Generated MCP user summary for user ${summary.userId}.`,
      data: summary,
      meta: {
        'openai/outputTemplate': SUMMARY_WIDGET_TEMPLATE_URI,
        ui: {
          resourceUri: SUMMARY_WIDGET_TEMPLATE_URI
        },
        generatedAt: new Date().toISOString()
      }
    };
  }

  if (name === 'steadyai.ask_agent') {
    const agentType = args.agentType;
    const prompt = args.prompt;

    if (!isAgentType(agentType)) {
      throw new Error('agentType must be one of MEAL_PLANNER, HABIT_COACH, COMMUNITY_GUIDE');
    }

    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('prompt is required');
    }

    const result = await generateAgentChatReply(agentType, prompt);
    return {
      text: result.text,
      data: result,
      meta: {
        'openai/outputTemplate': AGENT_WIDGET_TEMPLATE_URI,
        ui: {
          resourceUri: AGENT_WIDGET_TEMPLATE_URI
        },
        starterActions: ['Make simpler', '7-day version'],
        generatedAt: new Date().toISOString()
      }
    };
  }

  if (name === 'steadyai.educator_help') {
    const userQuestion = typeof args.userQuestion === 'string' ? args.userQuestion.trim() : '';
    const threadContext = typeof args.threadContext === 'string' ? args.threadContext.trim() : undefined;
    const communityPostText = typeof args.communityPostText === 'string' ? args.communityPostText.trim() : '';

    if (!userQuestion && !communityPostText) {
      throw new Error('Either userQuestion or communityPostText is required');
    }

    if (communityPostText) {
      const result = await generateMythCorrection({ communityPostText, threadContext });
      return {
        text: result.suggestedCorrection,
        data: {
          mode: 'myth-correction',
          ...result
        },
        meta: {
          'openai/outputTemplate': EDUCATOR_WIDGET_TEMPLATE_URI,
          ui: {
            resourceUri: EDUCATOR_WIDGET_TEMPLATE_URI
          },
          generatedAt: new Date().toISOString()
        }
      };
    }

    const result = await generateEducatorLesson({
      userQuestion,
      threadContext
    });

    return {
      text: result.lesson,
      data: {
        mode: 'lesson',
        ...result
      },
      meta: {
        'openai/outputTemplate': EDUCATOR_WIDGET_TEMPLATE_URI,
        ui: {
          resourceUri: EDUCATOR_WIDGET_TEMPLATE_URI
        },
        generatedAt: new Date().toISOString()
      }
    };
  }

  if (name === 'steadyai.workout_coach') {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) {
      throw new Error('prompt is required');
    }
    const userId = typeof args.userId === 'string' ? args.userId.trim() : '';
    const resolvedContext = await resolveUserContext(userId || undefined, authContext.userId);
    const latestInsight = resolvedContext.userId ? await getLatestWorkoutSessionInsight(resolvedContext.userId) : null;
    const history7d = resolvedContext.userId ? await getWorkoutHistorySummary(resolvedContext.userId, 7) : null;
    const preferences = resolvedContext.userId ? await getWorkoutPreferences(resolvedContext.userId) : null;
    const weeklyInsight = buildWeeklyInsight(history7d);
    let autoAdjustment: WorkoutAdjustment = 'neutral';
    if (latestInsight) {
      if (latestInsight.feedback === 'TOO_HARD' || latestInsight.completionRate < 0.5) {
        autoAdjustment = 'easier';
      } else if (latestInsight.feedback === 'TOO_EASY' || latestInsight.completionRate > 0.9) {
        autoAdjustment = 'harder';
      }
    }

    const currentPlan =
      args.currentPlan && typeof args.currentPlan === 'object' ? (args.currentPlan as WorkoutPlan) : undefined;
    const basePlan = buildWorkoutPlan(prompt, currentPlan, autoAdjustment);
    const plan = applyWorkoutPreferences(basePlan, preferences);

    return {
      text: `Workout ready: ${plan.exercises.length} exercises, about ${plan.estimatedTotalMin} minutes.`,
      data: {
        plan,
        promptUsed: prompt,
        userId: resolvedContext.userId,
        userContextSource: resolvedContext.source,
        autoAdjustment,
        latestSession: latestInsight,
        history7d,
        weeklyInsight,
        preferences
      },
      meta: {
        'openai/outputTemplate': WORKOUT_WIDGET_TEMPLATE_URI,
        ui: {
          resourceUri: WORKOUT_WIDGET_TEMPLATE_URI
        },
        generatedAt: new Date().toISOString()
      }
    };
  }

  if (name === 'steadyai.log_workout_session') {
    const userIdArg = typeof args.userId === 'string' ? args.userId.trim() : '';
    const resolvedUser = await resolveUserContext(userIdArg || undefined, authContext.userId);
    const userId = resolvedUser.userId ?? '';
    const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
    const totalDurationMinutes = typeof args.totalDurationMinutes === 'number' ? args.totalDurationMinutes : NaN;
    const completedExercises = typeof args.completedExercises === 'number' ? args.completedExercises : NaN;
    const totalExercises = typeof args.totalExercises === 'number' ? args.totalExercises : NaN;

    if (!userId || !sessionId) {
      throw new Error('userId (or authenticated user token) and sessionId are required');
    }

    const result = await logWorkoutSessionSummary({
      userId,
      sessionId,
      startedAt: typeof args.startedAt === 'string' ? args.startedAt : undefined,
      completedAt: typeof args.completedAt === 'string' ? args.completedAt : undefined,
      totalDurationMinutes,
      completedExercises,
      totalExercises,
      workoutPlan: args.workoutPlan && typeof args.workoutPlan === 'object' ? (args.workoutPlan as Record<string, unknown>) : undefined,
      feedback:
        args.feedback === 'TOO_EASY' || args.feedback === 'JUST_RIGHT' || args.feedback === 'TOO_HARD'
          ? args.feedback
          : undefined,
      sourceApp: 'steadyai-mcp-workout-widget'
    });

    return {
      text: `Workout session saved (${result.recordId}).`,
      data: result
    };
  }

  if (name === 'steadyai.get_current_user_context') {
    const requestedUserId = typeof args.userId === 'string' ? args.userId : undefined;
    const resolved = await resolveUserContext(requestedUserId, authContext.userId);
    return {
      text: resolved.userId ? `Resolved user context (${resolved.source}).` : 'No user found.',
      data: resolved
    };
  }

  if (name === 'steadyai.generate_checkin_draft') {
    const totalDurationMinutes = typeof args.totalDurationMinutes === 'number' ? Math.max(0, Math.floor(args.totalDurationMinutes)) : 0;
    const completedExercises = typeof args.completedExercises === 'number' ? Math.max(0, Math.floor(args.completedExercises)) : 0;
    const totalExercises = typeof args.totalExercises === 'number' ? Math.max(0, Math.floor(args.totalExercises)) : 0;
    const feedback =
      args.feedback === 'TOO_EASY' || args.feedback === 'JUST_RIGHT' || args.feedback === 'TOO_HARD'
        ? args.feedback
        : null;

    if (totalExercises <= 0) {
      throw new Error('totalExercises must be greater than 0');
    }

    const weeklyInsightArg = asObject(args.weeklyInsight);
    const weeklyInsight =
      typeof weeklyInsightArg.headline === 'string' && typeof weeklyInsightArg.suggestion === 'string'
        ? { headline: weeklyInsightArg.headline, suggestion: weeklyInsightArg.suggestion }
        : undefined;
    const draft = buildCheckInDraft({
      totalDurationMinutes,
      completedExercises,
      totalExercises,
      feedback,
      weeklyInsight
    });

    return {
      text: draft,
      data: {
        type: 'CHECK_IN',
        content: draft
      }
    };
  }

  if (name === 'steadyai.create_checkin_post') {
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    if (!content) {
      throw new Error('content is required');
    }

    const userIdArg = typeof args.userId === 'string' ? args.userId.trim() : '';
    const resolvedUser = await resolveUserContext(userIdArg || undefined, authContext.userId);
    if (!resolvedUser.userId) {
      throw new Error('No user context found. Authenticate or provide userId.');
    }

    const post = await createCommunityPost({
      userId: resolvedUser.userId,
      type: PostType.CHECK_IN,
      content
    });

    return {
      text: 'CHECK_IN post created.',
      data: {
        postId: post.id,
        createdAt: post.createdAt,
        content: post.content,
        type: post.type
      }
    };
  }

  if (name === 'steadyai.update_workout_preferences') {
    const userIdArg = typeof args.userId === 'string' ? args.userId.trim() : '';
    const resolvedUser = await resolveUserContext(userIdArg || undefined, authContext.userId);
    if (!resolvedUser.userId) {
      throw new Error('No user context found. Authenticate or provide userId.');
    }

    const updated = await upsertWorkoutPreferences(resolvedUser.userId, {
      preferredDurationMinutes: typeof args.preferredDurationMinutes === 'number' ? args.preferredDurationMinutes : undefined,
      preferredImpact:
        args.preferredImpact === 'LOW' || args.preferredImpact === 'MEDIUM' || args.preferredImpact === 'HIGH'
          ? args.preferredImpact
          : undefined,
      equipment: args.equipment === 'NONE' || args.equipment === 'HOME' || args.equipment === 'GYM' ? args.equipment : undefined,
      autoPostCheckIn: typeof args.autoPostCheckIn === 'boolean' ? args.autoPostCheckIn : undefined
    });

    return {
      text: 'Workout preferences saved.',
      data: {
        userId: resolvedUser.userId,
        ...updated
      }
    };
  }

  if (name === 'steadyai.nutrition_coach') {
    const mealText = typeof args.mealText === 'string' ? args.mealText.trim() : '';
    if (!mealText) {
      throw new Error('mealText is required');
    }
    const action = toNutritionAction(args.action);
    const userIdArg = typeof args.userId === 'string' ? args.userId.trim() : '';
    const resolvedUser = await resolveUserContext(userIdArg || undefined, authContext.userId);

    const estimation = await estimateNutrition(mealText);
    const totals = estimation.items.reduce(
      (acc, item) => {
        acc.calories += item.calories;
        acc.proteinG += item.proteinG ?? 0;
        acc.carbsG += item.carbsG ?? 0;
        acc.fatG += item.fatG ?? 0;
        return acc;
      },
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
    );

    const todaySummary = resolvedUser.userId ? await getNutritionSummaryToday(resolvedUser.userId) : null;
    const tips = buildNutritionTips(action, totals);
    const primary =
      action === 'LIGHTER'
        ? 'Lighter version ready.'
        : action === 'HIGH_PROTEIN'
          ? 'Higher-protein version ready.'
          : action === 'BALANCED'
            ? 'Balanced version ready.'
            : action === 'SWAP_CARB'
              ? 'Carb-swap version ready.'
              : 'Meal analysis ready.';

    return {
      text: `${primary} Estimated ${Math.round(totals.calories)} kcal with ${Math.round(totals.proteinG)}g protein.`,
      data: {
        mealText,
        action,
        totals: {
          calories: Math.round(totals.calories),
          proteinG: Number(totals.proteinG.toFixed(1)),
          carbsG: Number(totals.carbsG.toFixed(1)),
          fatG: Number(totals.fatG.toFixed(1))
        },
        items: estimation.items,
        itemCount: estimation.items.length,
        provider: estimation.provider,
        tips,
        todaySummary,
        userId: resolvedUser.userId
      },
      meta: {
        'openai/outputTemplate': NUTRITION_WIDGET_TEMPLATE_URI,
        ui: {
          resourceUri: NUTRITION_WIDGET_TEMPLATE_URI
        },
        generatedAt: new Date().toISOString()
      }
    };
  }

  if (name === 'steadyai.log_nutrition_intake') {
    const mealText = typeof args.mealText === 'string' ? args.mealText.trim() : '';
    if (!mealText) {
      throw new Error('mealText is required');
    }

    const userIdArg = typeof args.userId === 'string' ? args.userId.trim() : '';
    const resolvedUser = await resolveUserContext(userIdArg || undefined, authContext.userId);
    if (!resolvedUser.userId) {
      throw new Error('No user context found. Authenticate or provide userId.');
    }

    const entry = await ingestNutrition({
      userId: resolvedUser.userId,
      inputType: NutritionInputType.TEXT,
      rawText: mealText,
      consumedAt: typeof args.consumedAt === 'string' ? args.consumedAt : undefined
    });
    const todaySummary = await getNutritionSummaryToday(resolvedUser.userId);

    return {
      text: `Meal logged. Today: ${Math.round(todaySummary.calories)} kcal across ${todaySummary.entries} entr${todaySummary.entries === 1 ? 'y' : 'ies'}.`,
      data: {
        mealText,
        entryId: entry.id,
        consumedAt: entry.consumedAt,
        totals: {
          calories: Math.round(entry.totalCalories ?? 0),
          proteinG: Number(entry.totalProteinG ?? 0),
          carbsG: Number(entry.totalCarbsG ?? 0),
          fatG: Number(entry.totalFatG ?? 0)
        },
        todaySummary,
        userId: resolvedUser.userId
      },
      meta: {
        'openai/outputTemplate': NUTRITION_WIDGET_TEMPLATE_URI,
        ui: {
          resourceUri: NUTRITION_WIDGET_TEMPLATE_URI
        },
        generatedAt: new Date().toISOString()
      }
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

export async function appsMcpRoutes(fastify: FastifyInstance): Promise<void> {
  const manifestHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      name: 'SteadyAI',
      description:
        'SteadyAI coaching tools. For habit reset/meal/community guidance use steadyai.ask_agent; for personalized workouts with exercise GIFs use steadyai.workout_coach.',
      mcpServer: {
        transport: 'http',
        url: getPublicMcpUrl()
      },
      tools: TOOLS
    });
  };

  const mcpInfoHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      name: 'SteadyAI MCP',
      transport: 'http',
      url: getPublicMcpUrl(),
      capabilities: {
        tools: true,
        resources: true
      }
    });
  };

  const oauthProtectedResourceHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    const mcpUrl = getPublicMcpUrl();
    return reply.status(200).send({
      resource: mcpUrl,
      authorization_servers: [getOAuthIssuer()],
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid', 'profile', 'email']
    });
  };

  const oauthAuthorizationServerHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    const issuer = getOAuthIssuer();
    return reply.status(200).send({
      issuer,
      authorization_endpoint: getOAuthAuthorizeUrl(),
      token_endpoint: getOAuthTokenUrl(),
      registration_endpoint: null,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['openid', 'profile', 'email'],
      code_challenge_methods_supported: ['S256']
    });
  };

  const openIdConfigurationHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    const issuer = getOAuthIssuer();
    return reply.status(200).send({
      issuer,
      authorization_endpoint: getOAuthAuthorizeUrl(),
      token_endpoint: getOAuthTokenUrl(),
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      scopes_supported: ['openid', 'profile', 'email'],
      code_challenge_methods_supported: ['S256']
    });
  };

  const oauthAuthorizeHandler = async (
    request: FastifyRequest<{ Querystring: OAuthAuthorizeQuerystring }>,
    reply: FastifyReply
  ) => {
    if (!hasSupabaseOAuthSupport()) {
      return reply.status(503).send({ error: 'Supabase OAuth is not configured for MCP.' });
    }

    cleanupExpiredOAuthState();

    const authorizeQuery = getAuthorizeQueryFromRequest(request);
    try {
      const validated = validateAuthorizeRequest(authorizeQuery);
      const session = readMcpSession(request);

      if (!session) {
        reply.type('text/html; charset=utf-8');
        return reply.status(200).send(
          renderOAuthLoginPage({
            authorizeUrl: buildAuthorizeReturnTo(authorizeQuery)
          })
        );
      }

      const authCode = createAuthorizationCode({
        sessionId: session.id,
        clientId: validated.clientId,
        redirectUri: validated.redirectUri,
        scope: validated.scope,
        codeChallenge: validated.codeChallenge,
        codeChallengeMethod: validated.codeChallengeMethod
      });
      const redirectTarget = new URL(validated.redirectUri);
      redirectTarget.searchParams.set('code', authCode.code);
      redirectTarget.searchParams.set('state', validated.state);
      return reply.redirect(redirectTarget.toString());
    } catch (error) {
      reply.type('text/html; charset=utf-8');
      return reply.status(400).send(
        renderOAuthLoginPage({
          authorizeUrl: buildAuthorizeReturnTo(authorizeQuery),
          error: error instanceof Error ? error.message : 'Invalid OAuth request.'
        })
      );
    }
  };

  const oauthLoginHandler = async (
    request: FastifyRequest<{ Querystring: OAuthStartQuerystring }>,
    reply: FastifyReply
  ) => {
    if (!hasSupabaseOAuthSupport()) {
      return reply.status(503).send({ error: 'Supabase OAuth is not configured for MCP.' });
    }

    const provider = request.query.provider === 'apple' ? 'apple' : request.query.provider === 'google' ? 'google' : null;
    const returnTo = typeof request.query.return_to === 'string' ? request.query.return_to : '';
    if (!provider) {
      return reply.status(400).send({ error: 'provider must be google or apple' });
    }
    if (!returnTo) {
      return reply.status(400).send({ error: 'return_to is required' });
    }
    if (!returnTo.startsWith(getOAuthAuthorizeUrl())) {
      return reply.status(400).send({ error: 'return_to must point to the Steady AI authorize endpoint' });
    }

    const flowId = randomToken('supabase_flow');
    const codeVerifier = randomToken('code_verifier');
    const flow: PendingSupabaseFlow = {
      id: flowId,
      provider,
      returnTo,
      codeVerifier,
      createdAt: Date.now(),
      expiresAt: Date.now() + SUPABASE_FLOW_TTL_MS
    };
    pendingSupabaseFlows.set(flowId, flow);
    appendSetCookie(reply, serializeCookie(SUPABASE_FLOW_COOKIE, flowId, { maxAgeSeconds: SUPABASE_FLOW_TTL_MS / 1000 }));

    const callbackUrl = new URL('/oauth/callback', getOAuthIssuer());
    callbackUrl.searchParams.set('flow', flowId);

    const supabaseUrl = new URL(`${getSupabaseAuthBaseUrl()}/authorize`);
    supabaseUrl.searchParams.set('provider', provider);
    supabaseUrl.searchParams.set('redirect_to', callbackUrl.toString());
    supabaseUrl.searchParams.set('code_challenge', sha256Base64Url(codeVerifier));
    supabaseUrl.searchParams.set('code_challenge_method', 's256');

    return reply.redirect(supabaseUrl.toString());
  };

  const oauthCallbackHandler = async (
    request: FastifyRequest<{ Querystring: OAuthCallbackQuerystring }>,
    reply: FastifyReply
  ) => {
    if (!hasSupabaseOAuthSupport()) {
      return reply.status(503).send({ error: 'Supabase OAuth is not configured for MCP.' });
    }

    cleanupExpiredOAuthState();

    const cookies = parseCookies(request);
    const flowId = request.query.flow || cookies[SUPABASE_FLOW_COOKIE] || '';
    const flow = pendingSupabaseFlows.get(flowId);
    if (!flow) {
      return reply.status(400).send({ error: 'OAuth sign-in flow expired. Start again from ChatGPT.' });
    }
    pendingSupabaseFlows.delete(flowId);
    clearCookie(reply, SUPABASE_FLOW_COOKIE);

    if (request.query.error) {
      return reply.status(400).send({ error: request.query.error_description || request.query.error });
    }

    if (!request.query.code) {
      return reply.status(400).send({ error: 'Missing OAuth code from Supabase callback.' });
    }

    try {
      const sessionResponse = await exchangeSupabasePkceCode(request.query.code, flow.codeVerifier);
      const fallbackUser = await resolveUserFromSupabaseAccessToken(sessionResponse.access_token);
      const session = createMcpOAuthSession({
        accessToken: sessionResponse.access_token,
        refreshToken: sessionResponse.refresh_token ?? null,
        userId: sessionResponse.user?.id || fallbackUser.id,
        userEmail: sessionResponse.user?.email || fallbackUser.email || null,
        expiresInSeconds: sessionResponse.expires_in
      });
      setMcpSessionCookie(reply, session.id);
      return reply.redirect(flow.returnTo);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to complete Supabase sign-in.' });
    }
  };

  const oauthTokenHandler = async (
    request: FastifyRequest<{ Body: OAuthTokenBody }>,
    reply: FastifyReply
  ) => {
    if (!hasSupabaseOAuthSupport()) {
      return reply.status(503).send({ error: 'Supabase OAuth is not configured for MCP.' });
    }

    cleanupExpiredOAuthState();

    const body = (request.body ?? {}) as OAuthTokenBody;
    if (body.grant_type === 'authorization_code') {
      const code = typeof body.code === 'string' ? body.code : '';
      const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : '';
      const codeVerifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
      const clientId = typeof body.client_id === 'string' ? body.client_id : '';

      const record = mcpAuthorizationCodes.get(code);
      if (!record) {
        return reply.status(400).send({ error: 'Invalid authorization code' });
      }
      mcpAuthorizationCodes.delete(code);

      if (record.expiresAt <= Date.now()) {
        return reply.status(400).send({ error: 'Authorization code expired' });
      }
      if (redirectUri !== record.redirectUri) {
        return reply.status(400).send({ error: 'redirect_uri does not match' });
      }
      if (clientId && clientId !== record.clientId) {
        return reply.status(400).send({ error: 'client_id does not match' });
      }
      if (!codeVerifier) {
        return reply.status(400).send({ error: 'code_verifier is required' });
      }

      const computed = sha256Base64Url(codeVerifier);
      if (
        computed.length !== record.codeChallenge.length ||
        !timingSafeEqual(Buffer.from(computed), Buffer.from(record.codeChallenge))
      ) {
        return reply.status(400).send({ error: 'Invalid code_verifier' });
      }

      const session = mcpOAuthSessions.get(record.sessionId);
      if (!session) {
        return reply.status(400).send({ error: 'User session expired. Sign in again.' });
      }

      return reply.status(200).send({
        access_token: session.accessToken,
        token_type: 'Bearer',
        expires_in: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
        refresh_token: session.refreshToken,
        scope: record.scope
      });
    }

    if (body.grant_type === 'refresh_token') {
      const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
      if (!refreshToken) {
        return reply.status(400).send({ error: 'refresh_token is required' });
      }

      try {
        const refreshed = await refreshSupabaseAccessToken(refreshToken);
        return reply.status(200).send({
          access_token: refreshed.access_token,
          token_type: 'Bearer',
          expires_in: refreshed.expires_in ?? 3600,
          refresh_token: refreshed.refresh_token ?? refreshToken
        });
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to refresh token' });
      }
    }

    return reply.status(400).send({ error: 'Unsupported grant_type' });
  };

  const mcpPostHandler = async (request: FastifyRequest<{ Body: JsonRpcRequest }>, reply: FastifyReply) => {
    const body = request.body ?? {};
    const id = body.id ?? null;

    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      sendJsonRpcError(reply, id, -32600, 'Invalid Request');
      return;
    }

    try {
      if (body.method === 'initialize') {
        sendJsonRpcResult(reply, id, {
          protocolVersion: '2024-11-05',
          serverInfo: SERVER_INFO,
          capabilities: {
            tools: {}
          }
        });
        return;
      }

      if (body.method === 'tools/list') {
        sendJsonRpcResult(reply, id, { tools: TOOLS });
        return;
      }

      if (body.method === 'resources/list') {
        sendJsonRpcResult(reply, id, { resources: WIDGET_RESOURCES });
        return;
      }

      if (!ensureMcpRequestAuthorized(request, reply)) {
        return;
      }

      let authContext: McpAuthContext;
      try {
        authContext = await resolveMcpAuthContext(request);
      } catch {
        if (hasSupabaseOAuthSupport()) {
          sendOAuthChallenge(reply);
          return;
        }
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      if (body.method === 'resources/read') {
        const params = asObject(body.params);
        const uri = typeof params.uri === 'string' ? params.uri : '';
        const textByUri: Record<string, string> = {
          [AGENT_WIDGET_TEMPLATE_URI]: AGENT_WIDGET_HTML,
          [EDUCATOR_WIDGET_TEMPLATE_URI]: EDUCATOR_WIDGET_HTML,
          [SUMMARY_WIDGET_TEMPLATE_URI]: SUMMARY_WIDGET_HTML,
          [WORKOUT_WIDGET_TEMPLATE_URI]: WORKOUT_WIDGET_HTML,
          [NUTRITION_WIDGET_TEMPLATE_URI]: NUTRITION_WIDGET_HTML
        };
        const template = textByUri[uri];

        if (!template) {
          sendJsonRpcError(reply, id, -32000, `Resource not found: ${uri || '(empty uri)'}`);
          return;
        }

        sendJsonRpcResult(reply, id, {
          contents: [
            {
              uri,
              mimeType: 'text/html;profile=mcp-app',
              text: template,
              _meta: {
                ui: {
                  prefersBorder: true
                },
                'openai/widgetDescription':
                  uri === SUMMARY_WIDGET_TEMPLATE_URI
                    ? 'Compact user summary card with key challenge, community, and purchase metrics.'
                    : uri === NUTRITION_WIDGET_TEMPLATE_URI
                      ? 'Interactive nutrition coaching card with macro totals, quick adjustment actions, and meal logging.'
                    : uri === WORKOUT_WIDGET_TEMPLATE_URI
                      ? "Personalized workout card showing today's exercises with GIF links and quick modify actions."
                    : uri === EDUCATOR_WIDGET_TEMPLATE_URI
                      ? 'Interactive educator card with citations and clarification action.'
                      : 'Interactive SteadyAI coaching card with quick follow-up actions and fullscreen expansion.',
                'openai/widgetPrefersBorder': true
              }
            }
          ]
        });
        return;
      }

      if (body.method === 'tools/call') {
        const call = await handleToolCall(body.params, authContext);
        sendJsonRpcResult(reply, id, {
          content: [
            {
              type: 'text',
              text: call.text
            }
          ],
          structuredContent: call.data,
          _meta: call.meta ?? {}
        });
        return;
      }

      if (body.method === 'ping') {
        sendJsonRpcResult(reply, id, { ok: true });
        return;
      }

      sendJsonRpcError(reply, id, -32601, `Method not found: ${body.method}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      sendJsonRpcError(reply, id, -32000, message);
    }
  };

  fastify.get('/apps/manifest', manifestHandler);
  fastify.get<{ Querystring: OAuthAuthorizeQuerystring }>('/oauth/authorize', oauthAuthorizeHandler);
  fastify.get<{ Querystring: OAuthStartQuerystring }>('/oauth/login', oauthLoginHandler);
  fastify.get<{ Querystring: OAuthCallbackQuerystring }>('/oauth/callback', oauthCallbackHandler);
  fastify.post<{ Body: OAuthTokenBody }>('/oauth/token', oauthTokenHandler);
  fastify.get('/.well-known/oauth-protected-resource', oauthProtectedResourceHandler);
  fastify.get('/.well-known/oauth-protected-resource/mcp', oauthProtectedResourceHandler);
  fastify.get('/.well-known/oauth-authorization-server', oauthAuthorizationServerHandler);
  fastify.get('/.well-known/oauth-authorization-server/mcp', oauthAuthorizationServerHandler);
  fastify.get('/.well-known/openid-configuration', openIdConfigurationHandler);
  fastify.get('/mcp/.well-known/openid-configuration', openIdConfigurationHandler);
  fastify.get('/mcp', mcpInfoHandler);
  fastify.post<{ Body: JsonRpcRequest }>('/mcp', mcpPostHandler);
  fastify.post<{ Body: JsonRpcRequest }>('/apps/mcp', mcpPostHandler);
}
