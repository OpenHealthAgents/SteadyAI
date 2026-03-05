export const AGENT_DISCLAIMER =
  'Steady AI responses are educational and supportive. They are not medical advice, diagnosis, or treatment.';

export interface StarterPromptGroup {
  id: 'reset' | 'nutrition' | 'community' | 'myths';
  label: string;
  description: string;
  prompts: string[];
}

export const STARTER_PROMPT_GROUPS: StarterPromptGroup[] = [
  {
    id: 'reset',
    label: 'Reset Plan',
    description: 'Get back on track with low-pressure actions.',
    prompts: [
      'I missed 4 check-ins this week. Give me a simple reset plan.',
      'Build me a 7-day routine with one tiny daily habit.',
      'I keep skipping workouts after work. Give me a fallback routine.'
    ]
  },
  {
    id: 'nutrition',
    label: 'Nutrition',
    description: 'Meal planning with practical grocery guidance.',
    prompts: [
      'Plan a simple 3-day high-protein meal plan with quick dinners.',
      'Give me a low-cost grocery list for beginner meal prep.',
      'Suggest easy high-fiber breakfasts for busy mornings.'
    ]
  },
  {
    id: 'community',
    label: 'Community',
    description: 'Draft posts and supportive peer replies.',
    prompts: [
      'Suggest one low-pressure community post I can share today.',
      'Write a kind reply to someone who missed check-ins this week.',
      'Give me 3 ideas to engage in the community without oversharing.'
    ]
  },
  {
    id: 'myths',
    label: 'Myth Check',
    description: 'Get non-confrontational evidence-backed clarifications.',
    prompts: [
      'Explain the myth: carbs at night always cause fat gain.',
      'Is sweating more equal to burning more fat? Explain with context.',
      'Help me correct a nutrition myth politely in one short reply.'
    ]
  }
];

export const STARTER_PROMPTS: string[] = STARTER_PROMPT_GROUPS.flatMap((group) => group.prompts);
