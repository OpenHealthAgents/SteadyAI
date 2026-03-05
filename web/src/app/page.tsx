'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/auth';
import { AgentInteractionPanel } from '@/features/agents';
import { ChallengeCheckInCard } from '@/features/challenges';
import { CreatePostModal, FeedList, useCommunityFeed } from '@/features/community';
import { getReportsOverview, type ReportsOverview } from '@/features/reports';
import { DUMMY_STORE_PRODUCTS } from '@/features/store/dummyProducts';
import { getStoreProducts, ProductList, type StoreProduct } from '@/features/store';
import { createApiClient } from '@/lib/api';

type HubTab = 'assistant' | 'checkin' | 'community' | 'reports' | 'store';

const HUB_TABS: Array<{ key: HubTab; label: string; description: string }> = [
  { key: 'assistant', label: 'Assistant', description: 'Ask anything and get adaptive guidance' },
  { key: 'checkin', label: 'Check-In', description: 'Log today in one tap' },
  { key: 'community', label: 'Community', description: 'Post updates and react to peers' },
  { key: 'reports', label: 'Reports', description: 'View progress trends and adherence' },
  { key: 'store', label: 'Store', description: 'Browse optional support resources' }
];

const REPORT_DAY_WINDOWS = [7, 14, 30] as const;

export default function HomePage() {
  const { isHydrated, isAuthenticated, token } = useAuth();
  const [activeTab, setActiveTab] = useState<HubTab>('assistant');
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

  const api = useMemo(() => createApiClient(token ?? undefined), [token]);

  const {
    posts,
    groupId,
    activeChallengeId,
    isLoading: communityLoading,
    isRefreshing: communityRefreshing,
    isCreating: communityCreating,
    error: communityError,
    currentUserId,
    refresh,
    createPost,
    toggleReaction
  } = useCommunityFeed({
    token,
    enabled: isAuthenticated && activeTab === 'community'
  });

  useEffect(() => {
    if (!isAuthenticated || activeTab !== 'reports') {
      return;
    }

    let isMounted = true;

    async function run() {
      setReportLoading(true);
      setReportError(null);
      try {
        const next = await getReportsOverview(api, reportDays);
        if (isMounted) {
          setReportData(next);
        }
      } catch (error) {
        if (isMounted) {
          setReportError(error instanceof Error ? error.message : 'Failed to load reports');
        }
      } finally {
        if (isMounted) {
          setReportLoading(false);
        }
      }
    }

    void run();
    return () => {
      isMounted = false;
    };
  }, [activeTab, api, isAuthenticated, reportDays]);

  useEffect(() => {
    if (!isAuthenticated || activeTab !== 'store' || products.length > 0) {
      return;
    }

    let isMounted = true;

    async function run() {
      setStoreLoading(true);
      setStoreError(null);
      try {
        const next = await getStoreProducts(api);
        if (!isMounted) {
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
        if (isMounted) {
          setStoreError(error instanceof Error ? error.message : 'Failed to load store');
          setProducts(DUMMY_STORE_PRODUCTS);
          setUsingDummyData(true);
        }
      } finally {
        if (isMounted) {
          setStoreLoading(false);
        }
      }
    }

    void run();
    return () => {
      isMounted = false;
    };
  }, [activeTab, api, isAuthenticated, products.length]);

  const visibleProducts = useMemo(() => {
    const query = storeQuery.trim().toLowerCase();
    if (!query) {
      return products;
    }
    return products.filter((item) => {
      const content = `${item.name} ${item.description} ${item.whoItsFor}`.toLowerCase();
      return content.includes(query);
    });
  }, [products, storeQuery]);

  if (!isHydrated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-600" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="w-full max-w-md rounded-xl border border-indigo-100 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold text-gray-900">Steady AI</h1>
          <p className="mt-2 text-gray-600">Unified assistant hub for daily wellness actions.</p>
          <p className="mt-4 text-sm text-gray-600">Complete onboarding to unlock the single hub experience.</p>
          <div className="mt-5 flex flex-col gap-3">
            <Link
              href="/onboarding"
              className="rounded-lg bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Start Onboarding
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-slate-50 to-emerald-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Assistant Hub</h1>
          <p className="mt-1 text-sm text-gray-600">
            One screen for coaching, check-ins, community updates, progress reports, and store exploration.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {HUB_TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-xl border p-3 text-left transition ${
                    isActive ? 'border-black bg-black text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-sm font-semibold">{tab.label}</p>
                  <p className={`mt-1 text-xs ${isActive ? 'text-gray-100' : 'text-gray-500'}`}>{tab.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {activeTab === 'assistant' ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
            <AgentInteractionPanel embedded />
          </section>
        ) : null}

        {activeTab === 'checkin' ? (
          <section className="mx-auto w-full max-w-2xl">
            <ChallengeCheckInCard token={token} />
          </section>
        ) : null}

        {activeTab === 'community' ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Community Feed</h2>
                <p className="text-sm text-gray-600">Group: {groupId || 'Not assigned'} | Challenge: {activeChallengeId || 'None'}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreatePostOpen(true)}
                  className="rounded-md bg-black px-4 py-2 text-sm text-white"
                >
                  New post
                </button>
                <button
                  type="button"
                  onClick={() => void refresh('manual')}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm"
                  disabled={communityRefreshing || communityLoading}
                >
                  {communityRefreshing || communityLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </header>

            {communityError ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{communityError}</p> : null}

            {communityLoading ? (
              <p className="text-sm text-gray-600">Loading feed...</p>
            ) : (
              <FeedList posts={posts} currentUserId={currentUserId} onReact={(postId, type) => void toggleReaction(postId, type)} />
            )}

            <CreatePostModal
              isOpen={isCreatePostOpen}
              isSubmitting={communityCreating}
              onClose={() => setCreatePostOpen(false)}
              onSubmit={createPost}
            />
          </section>
        ) : null}

        {activeTab === 'reports' ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Reports</h2>
                <p className="text-sm text-gray-600">Track challenge adherence, workouts, nutrition, and community trends.</p>
              </div>
              <div className="flex gap-2">
                {REPORT_DAY_WINDOWS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setReportDays(days)}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      reportDays === days ? 'border-black bg-black text-white' : 'border-gray-300'
                    }`}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </header>

            {reportError ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{reportError}</p> : null}
            {reportLoading && !reportData ? <p className="text-sm text-gray-600">Loading report...</p> : null}

            {reportData ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Check-ins" value={String(reportData.challenge.totalCheckIns)} detail={`${Math.round(reportData.challenge.completionRate * 100)}% completed`} />
                <MetricCard label="Current Streak" value={`${reportData.challenge.currentStreakDays}d`} detail={reportData.challenge.activeParticipation ? 'Active participation' : 'No active challenge'} />
                <MetricCard label="Nutrition Entries" value={String(reportData.nutrition.entries)} detail={`${reportData.nutrition.calories} kcal total`} />
                <MetricCard label="Workouts" value={String(reportData.workout.sessions)} detail={`${reportData.workout.totalMinutes} minutes`} />
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'store' ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
            <header className="mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Store</h2>
              <p className="text-sm text-gray-600">Optional resources only. No urgency prompts or forced choices.</p>
            </header>

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Search</span>
                <input
                  value={storeQuery}
                  onChange={(event) => setStoreQuery(event.target.value)}
                  placeholder="Search by name, goal, or format"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                <p className="text-gray-500">Compare tray</p>
                <p className="text-xl font-semibold text-gray-900">{compareIds.length} / 3</p>
              </div>
            </div>

            {storeLoading ? <p className="text-sm text-gray-600">Loading products...</p> : null}
            {!storeLoading && storeError ? <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{storeError}</p> : null}
            {!storeLoading && usingDummyData ? (
              <p className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                Showing demo store catalog data.
              </p>
            ) : null}
            {!storeLoading && visibleProducts.length === 0 ? (
              <p className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">No matching products.</p>
            ) : null}

            {!storeLoading && visibleProducts.length > 0 ? (
              <ProductList
                items={visibleProducts}
                savedIds={savedIds}
                compareIds={compareIds}
                onToggleSaved={(id) =>
                  setSavedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
                }
                onToggleCompare={(id) =>
                  setCompareIds((prev) => {
                    if (prev.includes(id)) {
                      return prev.filter((item) => item !== id);
                    }
                    if (prev.length >= 3) {
                      return prev;
                    }
                    return [...prev, id];
                  })
                }
              />
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
      <p className="mt-1 text-sm text-gray-600">{detail}</p>
    </article>
  );
}
