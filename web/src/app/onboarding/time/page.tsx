'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardingStepScaffold, OptionButton, TIME_OPTIONS, useOnboarding } from '@/features/onboarding';

export default function TimePage() {
  const router = useRouter();
  const { draft, setTimeAvailability, submit, isSubmitting, clearError, error } = useOnboarding();

  useEffect(() => {
    if (!draft.primaryGoal) {
      router.replace('/onboarding/goal');
      return;
    }

    if (!draft.experienceLevel) {
      router.replace('/onboarding/experience');
      return;
    }
  }, [draft.experienceLevel, draft.primaryGoal, router]);

  return (
    <OnboardingStepScaffold
      stepKey="time"
      title="How much time can you commit each day?"
      description="This sets plan intensity and pacing."
      error={error}
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              clearError();
              router.push('/onboarding/diet');
            }}
            disabled={isSubmitting}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            Back
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await submit();
                router.replace('/');
              } catch {
                // Error state is handled in onboarding context.
              }
            }}
            disabled={!draft.timeAvailability || isSubmitting}
            className="w-full rounded-lg bg-black px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isSubmitting ? 'Submitting...' : 'Finish'}
          </button>
        </div>
      }
    >
      {TIME_OPTIONS.map((option) => (
        <OptionButton
          key={option}
          label={option}
          selected={draft.timeAvailability === option}
          onClick={() => setTimeAvailability(option)}
        />
      ))}
    </OnboardingStepScaffold>
  );
}
