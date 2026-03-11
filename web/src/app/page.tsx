'use client';

import Link from 'next/link';
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/auth';
import { AgentInteractionPanel } from '@/features/agents';
import type { AssistantIntent } from '@/features/agents/types';
import { ChallengeCheckInCard } from '@/features/challenges';
import { CreatePostModal, FeedList, useCommunityFeed } from '@/features/community';
import type { PostType } from '@/features/community';
import { getReportsOverview, type ReportsOverview } from '@/features/reports';
import { DUMMY_STORE_PRODUCTS } from '@/features/store/dummyProducts';
import { getStoreProducts, ProductList, type StoreProduct } from '@/features/store';
import { createApiClient } from '@/lib/api';

type FocusArea = 'coach' | 'fitness' | 'nutrition' | 'tracking' | 'community' | 'reports' | 'store';
type WorkoutFeedback = 'TOO_EASY' | 'JUST_RIGHT' | 'TOO_HARD';

interface WorkoutExercise {
  id: string;
  name: string;
  durationMin: number;
  reps: string;
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface WorkoutPlan {
  title: string;
  exercises: WorkoutExercise[];
}

interface NutritionLogResult {
  id: string;
  totalCalories: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  consumedAt: string;
  createdAt: string;
}

interface DeviceConsentState {
  health: boolean;
  location: boolean;
  motion: boolean;
  notifications: boolean;
}

interface DeviceSnapshot {
  capturedAt: string;
  timezone: string;
  language: string;
  platform: string;
  viewport: string;
  online: boolean;
  connectionType: string;
  isMobileLikely: boolean;
  location?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  motionStatus?: string;
  notificationStatus?: string;
}

const FOCUS_AREAS: Array<{ key: FocusArea; label: string; description: string }> = [
  { key: 'coach', label: 'Coach', description: 'Intent-led guidance and next best action' },
  { key: 'fitness', label: 'Fitness', description: 'Daily workout flow and session logging' },
  { key: 'nutrition', label: 'Nutrition', description: 'Meal capture, macros, and adherence' },
  { key: 'tracking', label: 'Tracking', description: 'Phone permissions, device signals, and health sync' },
  { key: 'community', label: 'Community', description: 'Peer wins, replies, and accountability' },
  { key: 'reports', label: 'Reports', description: 'Weekly patterns and progress story' },
  { key: 'store', label: 'Store', description: 'Optional products and support offers' }
];

const REPORT_DAY_WINDOWS = [7, 14, 30] as const;

const DEFAULT_WORKOUT_PLAN: WorkoutPlan = {
  title: 'Momentum builder: strength, posture, and core',
  exercises: [
    { id: 'ex-1', name: 'Goblet squat or bodyweight squat', durationMin: 8, reps: '3 x 12', impact: 'MEDIUM' },
    { id: 'ex-2', name: 'Push-up progression', durationMin: 7, reps: '3 x 10', impact: 'MEDIUM' },
    { id: 'ex-3', name: 'Split squat hold', durationMin: 6, reps: '2 x 30 sec / side', impact: 'MEDIUM' },
    { id: 'ex-4', name: 'Dead bug and plank finisher', durationMin: 9, reps: '3 rounds', impact: 'LOW' }
  ]
};

const DEFAULT_CONSENTS: DeviceConsentState = {
  health: false,
  location: false,
  motion: false,
  notifications: false
};

export default function HomePage() {
  const {
    isHydrated,
    isAuthenticated,
    isGoogleAuthConfigured,
    isAppleAuthConfigured,
    isPasswordAuthConfigured,
    isSigningInWithGoogle,
    isSigningInWithApple,
    signInWithGoogle,
    signInWithApple,
    token,
    userId
  } = useAuth();
  const [focusArea, setFocusArea] = useState<FocusArea>('coach');
  const [isCreatePostOpen, setCreatePostOpen] = useState(false);
  const [reportDays, setReportDays] = useState<number>(7);
  const [reportData, setReportData] = useState<ReportsOverview | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [usingDummyData, setUsingDummyData] = useState(false);
  const [storeQuery, setStoreQuery] = useState('');
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [nutritionInput, setNutritionInput] = useState('');
  const [nutritionConsumedAt, setNutritionConsumedAt] = useState('');
  const [nutritionLogs, setNutritionLogs] = useState<NutritionLogResult[]>([]);
  const [nutritionSaving, setNutritionSaving] = useState(false);
  const [nutritionMessage, setNutritionMessage] = useState<string | null>(null);
  const [nutritionError, setNutritionError] = useState<string | null>(null);
  const [workoutPlan] = useState<WorkoutPlan>(DEFAULT_WORKOUT_PLAN);
  const [workoutFeedback, setWorkoutFeedback] = useState<WorkoutFeedback | null>(null);
  const [workoutSaveMessage, setWorkoutSaveMessage] = useState<string | null>(null);
  const [workoutSaveError, setWorkoutSaveError] = useState<string | null>(null);
  const [isWorkoutSaving, setWorkoutSaving] = useState(false);
  const [deviceConsents, setDeviceConsents] = useState<DeviceConsentState>(DEFAULT_CONSENTS);
  const [deviceSnapshot, setDeviceSnapshot] = useState<DeviceSnapshot | null>(null);
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [healthDate, setHealthDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [healthSteps, setHealthSteps] = useState('6300');
  const [healthActivityMinutes, setHealthActivityMinutes] = useState('42');
  const [healthSyncMessage, setHealthSyncMessage] = useState<string | null>(null);
  const [healthSyncError, setHealthSyncError] = useState<string | null>(null);
  const [healthSyncing, setHealthSyncing] = useState(false);

  const api = useMemo(() => createApiClient(token ?? undefined), [token]);
  const resolvedUserId = useMemo(() => userId || decodeUserIdFromToken(token), [userId, token]);
  const deferredStoreQuery = useDeferredValue(storeQuery);

  const nutritionTotals = useMemo(
    () =>
      nutritionLogs.reduce(
        (acc, item) => {
          acc.calories += item.totalCalories;
          acc.protein += item.totalProteinG;
          acc.carbs += item.totalCarbsG;
          acc.fat += item.totalFatG;
          return acc;
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      ),
    [nutritionLogs]
  );

  const filteredProducts = useMemo(() => {
    const query = deferredStoreQuery.trim().toLowerCase();
    if (!query) {
      return products;
    }

    return products.filter((product) =>
      `${product.name} ${product.description} ${product.whoItsFor} ${product.whoItsNotFor}`.toLowerCase().includes(query)
    );
  }, [deferredStoreQuery, products]);

  const reportNarrative = useMemo(() => buildReportNarrative(reportData), [reportData]);

  const {
    posts,
    isLoading: communityLoading,
    isRefreshing: communityRefreshing,
    isCreating: communityCreating,
    error: communityError,
    currentUserId,
    refresh,
    createPost: createCommunityPostAction,
    toggleReaction
  } = useCommunityFeed({
    token,
    enabled: isAuthenticated && focusArea === 'community'
  });

  useEffect(() => {
    if (!isAuthenticated || (focusArea !== 'reports' && reportData)) {
      return;
    }

    let active = true;

    async function loadReports() {
      setReportLoading(true);
      setReportError(null);
      try {
        const next = await getReportsOverview(api, reportDays);
        if (active) {
          setReportData(next);
        }
      } catch (error) {
        if (active) {
          setReportError(error instanceof Error ? error.message : 'Failed to load reports.');
        }
      } finally {
        if (active) {
          setReportLoading(false);
        }
      }
    }

    void loadReports();

    return () => {
      active = false;
    };
  }, [api, focusArea, isAuthenticated, reportData, reportDays]);

  useEffect(() => {
    if (!isAuthenticated || focusArea !== 'store' || products.length > 0) {
      return;
    }

    let active = true;

    async function loadStore() {
      setStoreLoading(true);
      setStoreError(null);
      try {
        const next = await getStoreProducts(api);
        if (!active) {
          return;
        }

        if (next.length > 0) {
          setProducts(next);
          setUsingDummyData(false);
        } else {
          setProducts(DUMMY_STORE_PRODUCTS);
          setUsingDummyData(true);
        }
      } catch (error) {
        if (active) {
          setProducts(DUMMY_STORE_PRODUCTS);
          setUsingDummyData(true);
          setStoreError(error instanceof Error ? error.message : 'Failed to load store.');
        }
      } finally {
        if (active) {
          setStoreLoading(false);
        }
      }
    }

    void loadStore();

    return () => {
      active = false;
    };
  }, [api, focusArea, isAuthenticated, products.length]);

  function handleAssistantIntent(intent: AssistantIntent) {
    const next = mapIntentToFocus(intent);
    startTransition(() => {
      setFocusArea(next);
    });
  }

  async function submitNutritionLog(rawText: string): Promise<void> {
    const trimmed = rawText.trim();
    if (!trimmed) {
      setNutritionError('Describe what you ate to log nutrition.');
      return;
    }

    setNutritionError(null);
    setNutritionMessage(null);
    setNutritionSaving(true);

    try {
      const consumedAtIso = nutritionConsumedAt ? new Date(nutritionConsumedAt).toISOString() : undefined;
      const response = await api.post<NutritionLogResult, { inputType: 'TEXT'; rawText: string; consumedAt?: string }>(
        '/api/nutrition/ingest',
        {
          body: {
            inputType: 'TEXT',
            rawText: trimmed,
            consumedAt: consumedAtIso
          }
        }
      );

      setNutritionLogs((prev) => [response, ...prev].slice(0, 8));
      setNutritionInput('');
      setNutritionMessage('Meal captured and added to your tracker.');
    } catch (error) {
      setNutritionError(error instanceof Error ? error.message : 'Failed to save nutrition entry.');
    } finally {
      setNutritionSaving(false);
    }
  }

  async function saveWorkoutSession(feedback: WorkoutFeedback): Promise<void> {
    if (!resolvedUserId) {
      setWorkoutSaveError('Complete onboarding first so Steady AI has a profile to attach this workout to.');
      return;
    }

    setWorkoutSaveError(null);
    setWorkoutSaveMessage(null);
    setWorkoutSaving(true);
    setWorkoutFeedback(feedback);

    try {
      await api.post('/api/workouts/session-summary', {
        body: {
          userId: resolvedUserId,
          sessionId: `coach-plan-${new Date().toISOString().slice(0, 10)}`,
          totalDurationMinutes: workoutPlan.exercises.reduce((sum, exercise) => sum + exercise.durationMin, 0),
          completedExercises: workoutPlan.exercises.length,
          totalExercises: workoutPlan.exercises.length,
          feedback,
          workoutPlan,
          sourceApp: 'steadyai-web-coach'
        }
      });
      setWorkoutSaveMessage('Workout session saved into your tracking history.');
    } catch (error) {
      setWorkoutSaveError(error instanceof Error ? error.message : 'Failed to save workout session.');
    } finally {
      setWorkoutSaving(false);
    }
  }

  async function captureDeviceSignals(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    setDeviceError(null);
    setDeviceMessage(null);

    try {
      const nav = window.navigator as Navigator & {
        connection?: { effectiveType?: string };
        userAgentData?: { mobile?: boolean; platform?: string };
      };

      const snapshot: DeviceSnapshot = {
        capturedAt: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown',
        language: nav.language || 'Unknown',
        platform: nav.userAgentData?.platform || nav.platform || 'Unknown',
        viewport: `${window.innerWidth} x ${window.innerHeight}`,
        online: nav.onLine,
        connectionType: nav.connection?.effectiveType || 'Unknown',
        isMobileLikely:
          Boolean(nav.userAgentData?.mobile) ||
          /android|iphone|ipad|mobile/i.test(nav.userAgent || '')
      };

      if (deviceConsents.location && 'geolocation' in nav) {
        snapshot.location = await readCurrentLocation();
      }

      snapshot.motionStatus = deviceConsents.motion ? await getMotionStatus() : 'Not requested';
      snapshot.notificationStatus =
        deviceConsents.notifications && 'Notification' in window ? window.Notification.permission : 'Not requested';

      setDeviceSnapshot(snapshot);
      setDeviceMessage('Device signals captured. Nothing was synced automatically.');
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Failed to capture device signals.');
    }
  }

  async function requestLocationConsent(): Promise<void> {
    try {
      const location = await readCurrentLocation();
      setDeviceConsents((prev) => ({ ...prev, location: true }));
      setDeviceSnapshot((prev) => ({
        ...(prev || buildEmptySnapshot()),
        location,
        capturedAt: new Date().toISOString()
      }));
      setDeviceMessage('Location access granted for contextual coaching.');
      setDeviceError(null);
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Location permission was not granted.');
    }
  }

  async function requestMotionConsent(): Promise<void> {
    try {
      const status = await requestMotionPermission();
      setDeviceConsents((prev) => ({ ...prev, motion: status === 'granted' || prev.motion }));
      setDeviceMessage(status === 'granted' ? 'Motion access granted.' : 'Motion access is not available on this device.');
      setDeviceError(null);
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Motion permission was not granted.');
    }
  }

  async function requestNotificationConsent(): Promise<void> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setDeviceError('Notifications are not supported in this browser.');
      return;
    }

    const status = await window.Notification.requestPermission();
    setDeviceConsents((prev) => ({ ...prev, notifications: status === 'granted' || prev.notifications }));
    setDeviceMessage(status === 'granted' ? 'Notifications enabled for nudges and reminders.' : `Notification status: ${status}.`);
    setDeviceError(null);
  }

  async function syncHealthSummary(): Promise<void> {
    if (!resolvedUserId) {
      setHealthSyncError('Complete onboarding before syncing health data.');
      return;
    }

    if (!deviceConsents.health) {
      setHealthSyncError('Enable health data consent before syncing.');
      return;
    }

    setHealthSyncing(true);
    setHealthSyncError(null);
    setHealthSyncMessage(null);

    try {
      const result = await api.post<{ summary: { steps: number; activityMinutes: number } }, { userId: string; date: string; steps: number; activityMinutes: number; sourceApp: string }>(
        '/api/health/connect/summary',
        {
          body: {
            userId: resolvedUserId,
            date: healthDate,
            steps: Number(healthSteps),
            activityMinutes: Number(healthActivityMinutes),
            sourceApp: 'steadyai-mobile-consent-center'
          }
        }
      );

      setHealthSyncMessage(`Synced ${result.summary.steps} steps and ${result.summary.activityMinutes} active minutes.`);
      setFocusArea('reports');
      setReportData(null);
    } catch (error) {
      setHealthSyncError(error instanceof Error ? error.message : 'Failed to sync health summary.');
    } finally {
      setHealthSyncing(false);
    }
  }

  function toggleSaved(productId: string) {
    setSavedIds((prev) => (prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]));
  }

  function toggleCompare(productId: string) {
    setCompareIds((prev) => {
      if (prev.includes(productId)) {
        return prev.filter((id) => id !== productId);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), productId];
      }
      return [...prev, productId];
    });
  }

  async function handleCreatePost(type: PostType, content: string): Promise<void> {
    await createCommunityPostAction(type, content);
    setCreatePostOpen(false);
  }

  if (!isHydrated) {
    return <main className="min-h-screen bg-[#f7efe6]" />;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,240,220,0.95),_rgba(246,236,226,0.88)_38%,_rgba(244,239,232,1)_100%)] text-[#1d140d]">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
          <div className="rounded-[36px] border border-white/70 bg-white/72 p-6 shadow-[0_30px_120px_rgba(80,48,24,0.1)] backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#7a4b28]">Steady AI Coach OS</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              Conversational coaching that can plan, track, report, connect your phone, and keep your community moving.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#5f5145]">
              The assistant is the front door. What a user asks for decides whether the next step is a workout, nutrition log,
              sync flow, report, community action, or store offer.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Product shape"
                value="Coach + tracker"
                note="Fitness, nutrition, reporting, community, store"
              />
              <StatTile
                label="Data policy"
                value="Consent first"
                note="Phone signals are captured only when explicitly requested"
              />
              <StatTile
                label="UX principle"
                value="Simple flow"
                note="Ask naturally, then complete the guided action"
              />
            </div>

            {!isAuthenticated ? (
              <div className="mt-6 rounded-[28px] border border-[#e8c8a4] bg-[#fff3e3] p-5">
                <p className="text-sm text-[#7a4b28]">
                  Onboarding is required before Steady AI can store workouts, nutrition, reports, or health summaries.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {isPasswordAuthConfigured ? (
                    <Link
                      href="/sign-in?next=%2Fonboarding"
                      className="inline-flex rounded-full bg-[#1d140d] px-5 py-3 text-sm font-medium text-white"
                    >
                      Continue with email and password
                    </Link>
                  ) : null}
                  {isGoogleAuthConfigured ? (
                    <button
                      type="button"
                      onClick={() => {
                        void signInWithGoogle({ redirectTo: '/onboarding' });
                      }}
                      disabled={isSigningInWithGoogle || isSigningInWithApple}
                      className="inline-flex rounded-full border border-[#1d140d] bg-white px-5 py-3 text-sm font-medium text-[#1d140d] disabled:border-[#cab8a8] disabled:text-[#ab9a8c]"
                    >
                      {isSigningInWithGoogle ? 'Connecting Google...' : 'Continue with Google'}
                    </button>
                  ) : null}
                  {isAppleAuthConfigured ? (
                    <button
                      type="button"
                      onClick={() => {
                        void signInWithApple({ redirectTo: '/onboarding' });
                      }}
                      disabled={isSigningInWithGoogle || isSigningInWithApple}
                      className="inline-flex rounded-full border border-[#1d140d] bg-white px-5 py-3 text-sm font-medium text-[#1d140d] disabled:border-[#cab8a8] disabled:text-[#ab9a8c]"
                    >
                      {isSigningInWithApple ? 'Connecting Apple...' : 'Continue with Apple'}
                    </button>
                  ) : null}
                  <Link
                    href="/onboarding"
                    className="inline-flex rounded-full border border-[#d6b28d] px-5 py-3 text-sm font-medium text-[#7a4b28]"
                  >
                    {isGoogleAuthConfigured || isAppleAuthConfigured || isPasswordAuthConfigured ? 'Or continue onboarding' : 'Start onboarding'}
                  </Link>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="rounded-[36px] border border-[#e8d7c6] bg-[#1d140d] p-6 text-white shadow-[0_30px_120px_rgba(29,20,13,0.24)]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#d8c0ad]">Choose your focus</p>
            <p className="mt-3 text-sm leading-6 text-[#d8c0ad]">
              Jump straight into the area you want help with, or ask the coach and let Steady AI take you there.
            </p>
            <div className="mt-4 space-y-4">
              {FOCUS_AREAS.map((area) => {
                const active = area.key === focusArea;
                return (
                  <button
                    key={area.key}
                    type="button"
                    onClick={() => setFocusArea(area.key)}
                    className={`w-full rounded-[24px] border p-4 text-left transition ${
                      active
                        ? 'border-[#f0d7be] bg-[#fff4e7] text-[#1d140d]'
                        : 'border-white/15 bg-white/5 text-white hover:border-white/30 hover:bg-white/10'
                    }`}
                  >
                    <p className="text-sm font-semibold">{area.label}</p>
                    <p className={`mt-1 text-xs ${active ? 'text-[#655244]' : 'text-[#d8c0ad]'}`}>{area.description}</p>
                  </button>
                );
              })}
            </div>
          </aside>
        </header>

        <section className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
          <AgentInteractionPanel embedded onIntentDetected={handleAssistantIntent} />

          <aside className="space-y-5">
            <ActionAgenda
              focusArea={focusArea}
              reportData={reportData}
              nutritionTotals={nutritionTotals}
              deviceConsents={deviceConsents}
              productsCount={products.length}
              onJump={setFocusArea}
            />
            <PrivacyPanel
              deviceConsents={deviceConsents}
              onToggleHealth={() => setDeviceConsents((prev) => ({ ...prev, health: !prev.health }))}
              onRequestLocation={requestLocationConsent}
              onRequestMotion={requestMotionConsent}
              onRequestNotifications={requestNotificationConsent}
              onCapture={captureDeviceSignals}
              snapshot={deviceSnapshot}
              message={deviceMessage}
              error={deviceError}
            />
          </aside>
        </section>

        <section className="grid gap-8 lg:grid-cols-2">
          <section className="rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
            <SectionHeader
              eyebrow="Fitness"
              title="Interactive daily workout"
              description="A focused routine with quick logging so the assistant can use your response on the next turn."
            />
            <div className="mt-5 rounded-[28px] bg-[#fcf5ec] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{workoutPlan.title}</p>
                  <p className="text-sm text-[#66564a]">
                    {workoutPlan.exercises.length} exercises, {workoutPlan.exercises.reduce((sum, item) => sum + item.durationMin, 0)} min
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFocusArea('reports')}
                  className="rounded-full border border-[#d4bfaa] px-4 py-2 text-sm text-[#4d4036]"
                >
                  View trend impact
                </button>
              </div>
              <div className="mt-4 grid gap-3">
                {workoutPlan.exercises.map((exercise, index) => (
                  <div key={exercise.id} className="rounded-[24px] border border-[#ead9ca] bg-white px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {index + 1}. {exercise.name}
                      </p>
                      <span className="rounded-full bg-[#f6ebdf] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#7a4b28]">
                        {exercise.impact}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[#66564a]">
                      {exercise.reps} · {exercise.durationMin} minutes
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { key: 'TOO_EASY', label: 'Too easy' },
                { key: 'JUST_RIGHT', label: 'Just right' },
                { key: 'TOO_HARD', label: 'Too hard' }
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    void saveWorkoutSession(option.key as WorkoutFeedback);
                  }}
                  disabled={isWorkoutSaving}
                  className={`rounded-[22px] border px-4 py-4 text-sm transition ${
                    workoutFeedback === option.key
                      ? 'border-[#1d140d] bg-[#1d140d] text-white'
                      : 'border-[#d8c4b3] bg-[#fffaf5] text-[#4e4035] hover:bg-[#f6ede4]'
                  }`}
                >
                  {isWorkoutSaving && workoutFeedback === option.key ? 'Saving...' : option.label}
                </button>
              ))}
            </div>

            {workoutSaveMessage ? <p className="mt-4 text-sm text-emerald-700">{workoutSaveMessage}</p> : null}
            {workoutSaveError ? <p className="mt-4 text-sm text-red-700">{workoutSaveError}</p> : null}
          </section>

          <section className="rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
            <SectionHeader
              eyebrow="Nutrition"
              title="Simple meal logging"
              description="Users can describe food naturally. The backend handles parsing and totals."
            />
            <div className="mt-5 space-y-4">
              <textarea
                value={nutritionInput}
                onChange={(event) => setNutritionInput(event.target.value)}
                placeholder="Example: Greek yogurt, berries, two eggs, and coffee after my workout"
                className="min-h-28 w-full rounded-[28px] border border-[#dccbbb] bg-[#fffcf8] p-4 text-sm outline-none transition focus:border-[#1d140d]"
              />
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="datetime-local"
                  value={nutritionConsumedAt}
                  onChange={(event) => setNutritionConsumedAt(event.target.value)}
                  className="rounded-full border border-[#dccbbb] bg-[#fffcf8] px-4 py-3 text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    void submitNutritionLog(nutritionInput);
                  }}
                  disabled={nutritionSaving}
                  className="rounded-full bg-[#1d140d] px-5 py-3 text-sm text-white disabled:bg-[#ab9a8c]"
                >
                  {nutritionSaving ? 'Saving meal...' : 'Log meal'}
                </button>
              </div>
              {nutritionMessage ? <p className="text-sm text-emerald-700">{nutritionMessage}</p> : null}
              {nutritionError ? <p className="text-sm text-red-700">{nutritionError}</p> : null}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <StatTile label="Calories" value={String(nutritionTotals.calories)} note="Current session" />
              <StatTile label="Protein" value={`${nutritionTotals.protein}g`} note="Logged total" />
              <StatTile label="Carbs" value={`${nutritionTotals.carbs}g`} note="Logged total" />
              <StatTile label="Fat" value={`${nutritionTotals.fat}g`} note="Logged total" />
            </div>

            <div className="mt-5 space-y-3">
              {nutritionLogs.length === 0 ? (
                <p className="rounded-[24px] border border-dashed border-[#d8c4b3] p-4 text-sm text-[#66564a]">
                  Meal entries will appear here after the first log.
                </p>
              ) : (
                nutritionLogs.map((entry) => (
                  <div key={entry.id} className="rounded-[24px] border border-[#ead9ca] bg-[#fcf5ec] px-4 py-4">
                    <p className="text-sm font-medium">
                      {entry.totalCalories} kcal · {entry.totalProteinG}g protein · {entry.totalCarbsG}g carbs · {entry.totalFatG}g fat
                    </p>
                    <p className="mt-1 text-xs text-[#77685d]">
                      Logged {formatFriendlyDate(entry.createdAt)} · Consumed {formatFriendlyDate(entry.consumedAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </section>

        <section className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
            <SectionHeader
              eyebrow="Tracking"
              title="Phone data and consent center"
              description="Capture device context, request permissions, and sync a health summary without hiding the privacy model."
            />

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <ConsentCard
                title="Health data"
                description="Allow health summaries like steps and active minutes to be synced into reports."
                active={deviceConsents.health}
                actionLabel={deviceConsents.health ? 'Enabled' : 'Enable'}
                onAction={() => setDeviceConsents((prev) => ({ ...prev, health: !prev.health }))}
              />
              <ConsentCard
                title="Location context"
                description="Use current location for weather, context, and better daily coaching prompts."
                active={deviceConsents.location}
                actionLabel="Request"
                onAction={() => {
                  void requestLocationConsent();
                }}
              />
              <ConsentCard
                title="Motion signals"
                description="Ask the phone for motion access when the platform supports it."
                active={deviceConsents.motion}
                actionLabel="Request"
                onAction={() => {
                  void requestMotionConsent();
                }}
              />
              <ConsentCard
                title="Reminders"
                description="Enable notifications for check-ins, reports, and nutrition nudges."
                active={deviceConsents.notifications}
                actionLabel="Request"
                onAction={() => {
                  void requestNotificationConsent();
                }}
              />
            </div>

            <div className="mt-5 rounded-[28px] border border-[#ead9ca] bg-[#fcf5ec] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Capture device snapshot</p>
                  <p className="text-sm text-[#66564a]">Collect a local summary of the current phone or browser context.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void captureDeviceSignals();
                  }}
                  className="rounded-full bg-[#1d140d] px-5 py-3 text-sm text-white"
                >
                  Capture now
                </button>
              </div>
              {deviceMessage ? <p className="mt-4 text-sm text-emerald-700">{deviceMessage}</p> : null}
              {deviceError ? <p className="mt-4 text-sm text-red-700">{deviceError}</p> : null}
              {deviceSnapshot ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <MiniMetric label="Captured" value={formatFriendlyDate(deviceSnapshot.capturedAt)} />
                  <MiniMetric label="Timezone" value={deviceSnapshot.timezone} />
                  <MiniMetric label="Platform" value={deviceSnapshot.platform} />
                  <MiniMetric label="Viewport" value={deviceSnapshot.viewport} />
                  <MiniMetric label="Connection" value={deviceSnapshot.connectionType} />
                  <MiniMetric label="Device type" value={deviceSnapshot.isMobileLikely ? 'Mobile likely' : 'Desktop or tablet'} />
                  <MiniMetric label="Online" value={deviceSnapshot.online ? 'Yes' : 'No'} />
                  <MiniMetric label="Notifications" value={deviceSnapshot.notificationStatus || 'Unknown'} />
                  {deviceSnapshot.location ? (
                    <MiniMetric
                      label="Location"
                      value={`${deviceSnapshot.location.latitude.toFixed(3)}, ${deviceSnapshot.location.longitude.toFixed(3)}`}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-5 rounded-[28px] border border-[#ead9ca] bg-white p-5">
              <p className="text-sm font-semibold">Sync aggregated health summary</p>
              <p className="mt-1 text-sm text-[#66564a]">
                This uses the existing health ingestion endpoint and stores summary-only records for reporting.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="space-y-2 text-sm">
                  <span>Date</span>
                  <input
                    type="date"
                    value={healthDate}
                    onChange={(event) => setHealthDate(event.target.value)}
                    className="w-full rounded-full border border-[#dccbbb] bg-[#fffcf8] px-4 py-3"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span>Steps</span>
                  <input
                    type="number"
                    min="0"
                    value={healthSteps}
                    onChange={(event) => setHealthSteps(event.target.value)}
                    className="w-full rounded-full border border-[#dccbbb] bg-[#fffcf8] px-4 py-3"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span>Active minutes</span>
                  <input
                    type="number"
                    min="0"
                    value={healthActivityMinutes}
                    onChange={(event) => setHealthActivityMinutes(event.target.value)}
                    className="w-full rounded-full border border-[#dccbbb] bg-[#fffcf8] px-4 py-3"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => {
                  void syncHealthSummary();
                }}
                disabled={healthSyncing}
                className="mt-4 rounded-full bg-[#1d140d] px-5 py-3 text-sm text-white disabled:bg-[#ab9a8c]"
              >
                {healthSyncing ? 'Syncing...' : 'Sync summary'}
              </button>
              {healthSyncMessage ? <p className="mt-4 text-sm text-emerald-700">{healthSyncMessage}</p> : null}
              {healthSyncError ? <p className="mt-4 text-sm text-red-700">{healthSyncError}</p> : null}
            </div>
          </section>

          <section className="space-y-8">
            <section className="rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
              <SectionHeader
                eyebrow="Reports"
                title="Generated progress story"
                description="Readable insight cards plus quick charts for consistency, calories, workouts, and community."
              />
              <div className="mt-5 flex flex-wrap gap-2">
                {REPORT_DAY_WINDOWS.map((windowDays) => (
                  <button
                    key={windowDays}
                    type="button"
                    onClick={() => {
                      setReportDays(windowDays);
                      setReportData(null);
                      setFocusArea('reports');
                    }}
                    className={`rounded-full px-4 py-2 text-sm ${
                      reportDays === windowDays
                        ? 'bg-[#1d140d] text-white'
                        : 'border border-[#dccbbb] bg-[#fffaf5] text-[#4e4035]'
                    }`}
                  >
                    Last {windowDays} days
                  </button>
                ))}
              </div>

              {reportLoading ? <p className="mt-5 text-sm text-[#66564a]">Loading reports...</p> : null}
              {reportError ? <p className="mt-5 text-sm text-red-700">{reportError}</p> : null}
              {!reportLoading && !reportError && reportData ? (
                <>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StatTile label="Workout sessions" value={String(reportData.workout.sessions)} note="Current window" />
                    <StatTile label="Current streak" value={`${reportData.challenge.currentStreakDays} days`} note="Completed check-ins" />
                    <StatTile label="Nutrition entries" value={String(reportData.nutrition.entries)} note="Tracked meals" />
                    <StatTile label="Community posts" value={String(reportData.community.posts)} note="Authored updates" />
                  </div>
                  <div className="mt-5 rounded-[28px] bg-[#fcf5ec] p-5">
                    <p className="text-sm font-semibold">Coach summary</p>
                    <p className="mt-2 text-sm leading-7 text-[#5f5145]">{reportNarrative}</p>
                  </div>
                  <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    <TrendCard title="Check-ins completed" items={reportData.trends.checkInsCompleted} />
                    <TrendCard title="Calories logged" items={reportData.trends.calories} />
                    <TrendCard title="Workout minutes" items={reportData.trends.workoutMinutes} />
                    <TrendCard title="Community posts" items={reportData.trends.communityPosts} />
                  </div>
                </>
              ) : null}
            </section>

            <section className="rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
              <SectionHeader
                eyebrow="Community"
                title="Engagement and accountability"
                description="A social layer for wins, questions, check-ins, and replies."
              />
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setFocusArea('community');
                    setCreatePostOpen(true);
                  }}
                  disabled={!isAuthenticated}
                  className="rounded-full bg-[#1d140d] px-5 py-3 text-sm text-white disabled:bg-[#ab9a8c]"
                >
                  Create post
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void refresh('manual');
                    setFocusArea('community');
                  }}
                  disabled={!isAuthenticated || communityRefreshing}
                  className="rounded-full border border-[#dccbbb] bg-[#fffaf5] px-5 py-3 text-sm text-[#4e4035]"
                >
                  {communityRefreshing ? 'Refreshing...' : 'Refresh feed'}
                </button>
              </div>
              {communityError ? <p className="mt-4 text-sm text-red-700">{communityError}</p> : null}
              <div className="mt-5">
                {isAuthenticated ? (
                  communityLoading ? (
                    <p className="text-sm text-[#66564a]">Loading community feed...</p>
                  ) : (
                    <FeedList posts={posts} currentUserId={currentUserId} onReact={toggleReaction} />
                  )
                ) : (
                  <p className="rounded-[24px] border border-dashed border-[#d8c4b3] p-4 text-sm text-[#66564a]">
                    Sign in through onboarding to post, react, and join challenges.
                  </p>
                )}
              </div>
            </section>
          </section>
        </section>

        <section className="rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
          <SectionHeader
            eyebrow="Store"
            title="Optional support store"
            description="Resources should feel additive and well-matched, not pushy."
          />
          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <input
              type="search"
              value={storeQuery}
              onChange={(event) => setStoreQuery(event.target.value)}
              placeholder="Search products by need, outcome, or format"
              className="w-full rounded-full border border-[#dccbbb] bg-[#fffcf8] px-5 py-3 text-sm outline-none transition focus:border-[#1d140d] lg:max-w-md"
            />
            <div className="flex flex-wrap gap-3 text-sm text-[#66564a]">
              <span>{filteredProducts.length} visible</span>
              <span>{savedIds.length} saved</span>
              <span>{compareIds.length} compare</span>
              {usingDummyData ? <span>Preview catalog</span> : null}
            </div>
          </div>
          {storeLoading ? <p className="mt-5 text-sm text-[#66564a]">Loading store...</p> : null}
          {storeError ? <p className="mt-5 text-sm text-red-700">{storeError}</p> : null}
          <div className="mt-5">
            <ProductList
              items={filteredProducts}
              savedIds={savedIds}
              compareIds={compareIds}
              onToggleSaved={toggleSaved}
              onToggleCompare={toggleCompare}
            />
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
            <SectionHeader
              eyebrow="Check-In"
              title="One-tap daily adherence"
              description="Preserve a lightweight daily action so the assistant has fresh state."
            />
            {isAuthenticated ? (
              <div className="mt-5">
                <ChallengeCheckInCard token={token} />
              </div>
            ) : (
              <p className="mt-5 rounded-[24px] border border-dashed border-[#d8c4b3] p-4 text-sm text-[#66564a]">
                This becomes available after onboarding creates a user profile.
              </p>
            )}
          </section>

          <section className="rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
            <SectionHeader
              eyebrow="System direction"
              title="How the new product behaves"
              description="The application is now framed as a coordinated fitness and nutrition operating surface."
            />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <NarrativeCard
                title="Conversational first"
                text="The assistant is no longer a side panel. It is the primary way users tell the app what they need."
              />
              <NarrativeCard
                title="Intent-led routing"
                text="When a user asks to log food, sync steps, train, post, or inspect progress, the interface pivots to the relevant module."
              />
              <NarrativeCard
                title="Explicit privacy"
                text="Phone and browser data capture sits behind named consent controls, with local snapshot visibility before syncing."
              />
              <NarrativeCard
                title="Unified engagement"
                text="Tracking, community, reports, and store now sit in one coherent coaching journey instead of separate disconnected tools."
              />
            </div>
          </section>
        </section>
      </section>

      <CreatePostModal
        isOpen={isCreatePostOpen}
        isSubmitting={communityCreating}
        onClose={() => setCreatePostOpen(false)}
        onSubmit={handleCreatePost}
      />
    </main>
  );
}

function mapIntentToFocus(intent: AssistantIntent): FocusArea {
  switch (intent) {
    case 'FITNESS':
      return 'fitness';
    case 'NUTRITION':
      return 'nutrition';
    case 'TRACKING':
      return 'tracking';
    case 'CHECK_IN':
      return 'coach';
    case 'COMMUNITY':
      return 'community';
    case 'REPORTS':
      return 'reports';
    case 'STORE':
      return 'store';
    default:
      return 'coach';
  }
}

function decodeUserIdFromToken(token: string | null): string | null {
  if (!token) {
    return null;
  }

  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) {
      return null;
    }

    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(normalized)) as { sub?: string; userId?: string; uid?: string };
    return payload.sub || payload.userId || payload.uid || null;
  } catch {
    return null;
  }
}

function formatFriendlyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function buildReportNarrative(reportData: ReportsOverview | null): string {
  if (!reportData) {
    return 'Generate a report to see how check-ins, workouts, meals, and community behavior combine into one progress view.';
  }

  const adherence = Math.round(reportData.challenge.completionRate * 100);
  const workoutQuality = reportData.workout.avgCompletionRate ? Math.round(reportData.workout.avgCompletionRate * 100) : null;
  const topArea =
    reportData.community.posts > 0
      ? 'community momentum'
      : reportData.nutrition.entries > 0
        ? 'nutrition consistency'
        : reportData.workout.sessions > 0
          ? 'training follow-through'
          : 'check-in awareness';

  return `Over the last ${reportData.period.days} days, your strongest visible signal is ${topArea}. You completed ${adherence}% of logged check-ins, trained ${reportData.workout.sessions} times for ${reportData.workout.totalMinutes} total minutes, and tracked ${reportData.nutrition.entries} nutrition entries. ${workoutQuality !== null ? `Average workout completion is ${workoutQuality}%. ` : ''}The next coaching move is to preserve what is already happening consistently and add one small improvement in the weakest area.`;
}

function buildEmptySnapshot(): DeviceSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown',
    language: typeof navigator !== 'undefined' ? navigator.language || 'Unknown' : 'Unknown',
    platform: typeof navigator !== 'undefined' ? navigator.platform || 'Unknown' : 'Unknown',
    viewport: typeof window !== 'undefined' ? `${window.innerWidth} x ${window.innerHeight}` : 'Unknown',
    online: typeof navigator !== 'undefined' ? navigator.onLine : false,
    connectionType: 'Unknown',
    isMobileLikely: false
  };
}

function readCurrentLocation(): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Geolocation is not available.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        reject(new Error(error.message || 'Unable to read current location.'));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
}

async function requestMotionPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (typeof window === 'undefined') {
    return 'unsupported';
  }

  const motionEvent = window.DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };

  if (typeof motionEvent?.requestPermission === 'function') {
    return motionEvent.requestPermission();
  }

  return 'unsupported';
}

async function getMotionStatus(): Promise<string> {
  const status = await requestMotionPermission();
  return status === 'unsupported' ? 'Available only on supported mobile browsers' : status;
}

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="rounded-[24px] border border-[#ead9ca] bg-[#fffaf5] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7a4b28]">{label}</p>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="mt-2 text-sm text-[#66564a]">{note}</p>
    </article>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#7a4b28]">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5f5145]">{description}</p>
    </header>
  );
}

function ActionAgenda({
  focusArea,
  reportData,
  nutritionTotals,
  deviceConsents,
  productsCount,
  onJump
}: {
  focusArea: FocusArea;
  reportData: ReportsOverview | null;
  nutritionTotals: { calories: number; protein: number; carbs: number; fat: number };
  deviceConsents: DeviceConsentState;
  productsCount: number;
  onJump: (value: FocusArea) => void;
}) {
  const cards = [
    {
      title: 'Current focus',
      body: `The dashboard is centered on ${focusArea}. Ask the assistant a new question to re-route instantly.`,
      action: { label: 'Go to coach', target: 'coach' as FocusArea }
    },
    {
      title: 'Next nutrition move',
      body:
        nutritionTotals.calories > 0
          ? `You have logged ${nutritionTotals.calories} calories so far. Add the next meal or snack while details are still fresh.`
          : 'No meals logged in this session yet. Start with the next thing you eat instead of reconstructing the full day.',
      action: { label: 'Open nutrition', target: 'nutrition' as FocusArea }
    },
    {
      title: 'Tracking readiness',
      body: `${Object.values(deviceConsents).filter(Boolean).length}/4 permissions are enabled. Health consent controls whether summaries can be synced into reports.`,
      action: { label: 'Open tracking', target: 'tracking' as FocusArea }
    },
    {
      title: 'Commercial surface',
      body: `${productsCount || DUMMY_STORE_PRODUCTS.length} store items are available for optional upsell or guided support.`,
      action: { label: 'Open store', target: 'store' as FocusArea }
    }
  ];

  if (reportData) {
    cards[0] = {
      title: 'Latest report signal',
      body: `Current streak is ${reportData.challenge.currentStreakDays} days and workout minutes total ${reportData.workout.totalMinutes} in the active report window.`,
      action: { label: 'Open reports', target: 'reports' as FocusArea }
    };
  }

  return (
    <section className="rounded-[32px] border border-white/60 bg-white/80 p-5 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7a4b28]">Coach agenda</p>
      <div className="mt-4 space-y-3">
        {cards.map((card) => (
          <div key={card.title} className="rounded-[24px] border border-[#ead9ca] bg-[#fffaf5] p-4">
            <p className="text-sm font-semibold">{card.title}</p>
            <p className="mt-2 text-sm leading-6 text-[#5f5145]">{card.body}</p>
            <button
              type="button"
              onClick={() => onJump(card.action.target)}
              className="mt-3 rounded-full border border-[#d4bfaa] px-4 py-2 text-sm text-[#4d4036]"
            >
              {card.action.label}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PrivacyPanel({
  deviceConsents,
  onToggleHealth,
  onRequestLocation,
  onRequestMotion,
  onRequestNotifications,
  onCapture,
  snapshot,
  message,
  error
}: {
  deviceConsents: DeviceConsentState;
  onToggleHealth: () => void;
  onRequestLocation: () => void;
  onRequestMotion: () => void;
  onRequestNotifications: () => void;
  onCapture: () => void;
  snapshot: DeviceSnapshot | null;
  message: string | null;
  error: string | null;
}) {
  return (
    <section className="rounded-[32px] border border-[#e6d7c8] bg-[#1d140d] p-5 text-white shadow-[0_24px_80px_rgba(29,20,13,0.22)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#d8c0ad]">Privacy controls</p>
      <div className="mt-4 space-y-3">
        <QuickPermissionRow label="Health summary sync" active={deviceConsents.health} onAction={onToggleHealth} />
        <QuickPermissionRow label="Location" active={deviceConsents.location} onAction={onRequestLocation} />
        <QuickPermissionRow label="Motion" active={deviceConsents.motion} onAction={onRequestMotion} />
        <QuickPermissionRow label="Notifications" active={deviceConsents.notifications} onAction={onRequestNotifications} />
      </div>
      <button type="button" onClick={onCapture} className="mt-4 rounded-full bg-[#fff4e7] px-5 py-3 text-sm text-[#1d140d]">
        Capture device snapshot
      </button>
      {message ? <p className="mt-4 text-sm text-[#c2f0d2]">{message}</p> : null}
      {error ? <p className="mt-4 text-sm text-[#ffb4b4]">{error}</p> : null}
      {snapshot ? (
        <p className="mt-4 text-sm leading-6 text-[#e9d7c7]">
          Latest snapshot: {snapshot.platform}, {snapshot.viewport}, {snapshot.connectionType}, {snapshot.timezone}.
        </p>
      ) : null}
    </section>
  );
}

function QuickPermissionRow({
  label,
  active,
  onAction
}: {
  label: string;
  active: boolean;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[20px] border border-white/10 bg-white/5 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-[#d8c0ad]">{active ? 'Enabled' : 'Disabled'}</p>
      </div>
      <button type="button" onClick={onAction} className="rounded-full border border-white/20 px-4 py-2 text-sm">
        {active ? 'Update' : 'Enable'}
      </button>
    </div>
  );
}

function ConsentCard({
  title,
  description,
  active,
  actionLabel,
  onAction
}: {
  title: string;
  description: string;
  active: boolean;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <article className="rounded-[24px] border border-[#ead9ca] bg-[#fffaf5] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        <span className={`rounded-full px-3 py-1 text-xs ${active ? 'bg-[#dbf6e5] text-[#1d7a48]' : 'bg-[#f1e5d9] text-[#7a4b28]'}`}>
          {active ? 'On' : 'Off'}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#5f5145]">{description}</p>
      <button type="button" onClick={onAction} className="mt-4 rounded-full border border-[#d4bfaa] px-4 py-2 text-sm text-[#4d4036]">
        {actionLabel}
      </button>
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-[#ead9ca] bg-[#fffaf5] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7a4b28]">{label}</p>
      <p className="mt-2 text-sm leading-6 text-[#4d4036]">{value}</p>
    </div>
  );
}

function TrendCard({
  title,
  items
}: {
  title: string;
  items: Array<{ date: string; label: string; value: number }>;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <article className="rounded-[28px] border border-[#ead9ca] bg-white p-5">
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={`${title}-${item.date}`} className="grid grid-cols-[56px_1fr_44px] items-center gap-3">
            <span className="text-xs text-[#77685d]">{item.label}</span>
            <div className="h-2 rounded-full bg-[#f2e7db]">
              <div
                className="h-2 rounded-full bg-[#1d140d]"
                style={{ width: `${Math.max(10, Math.round((item.value / max) * 100))}%` }}
              />
            </div>
            <span className="text-right text-xs text-[#4d4036]">{item.value}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function NarrativeCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="rounded-[24px] border border-[#ead9ca] bg-[#fffaf5] p-5">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 text-sm leading-7 text-[#5f5145]">{text}</p>
    </article>
  );
}
