'use client';

import { useState } from 'react';
import { requestAgentReply } from './api';
import { AGENT_DISCLAIMER, STARTER_PROMPT_GROUPS, STARTER_PROMPTS } from './data';
import type { AssistantIntent, ChatMessage } from './types';

interface AgentInteractionPanelProps {
  embedded?: boolean;
  onIntentDetected?: (intent: AssistantIntent) => void;
}

export function AgentInteractionPanel({ embedded = false, onIntentDetected }: AgentInteractionPanelProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [activePromptGroup, setActivePromptGroup] = useState<(typeof STARTER_PROMPT_GROUPS)[number]['id']>(
    STARTER_PROMPT_GROUPS[0].id
  );
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage()]);

  const visibleGroup = STARTER_PROMPT_GROUPS.find((group) => group.id === activePromptGroup) || STARTER_PROMPT_GROUPS[0];

  async function sendPrompt(promptText: string): Promise<void> {
    const prompt = promptText.trim();
    if (!prompt || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: prompt,
      createdAt: new Date().toISOString()
    };
    const pendingId = `pending-${Date.now()}`;
    const pendingMessage: ChatMessage = {
      id: pendingId,
      role: 'system',
      text: 'Thinking...',
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMessage, pendingMessage]);
    setInput('');
    setIsSending(true);

    try {
      const reply = await requestAgentReply(prompt);
      const agentMessage: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        text: reply.text,
        routedIntent: reply.intent,
        reasoning: reply.reasoning,
        cards: reply.cards,
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => prev.filter((m) => m.id !== pendingId).concat(agentMessage));
      if (reply.intent) {
        onIntentDetected?.(reply.intent);
      }
    } catch {
      setMessages((prev) =>
        prev.filter((m) => m.id !== pendingId).concat({
          id: `fallback-${Date.now()}`,
          role: 'agent',
          text: 'Assistant is temporarily unavailable. Please retry in a few seconds.',
          createdAt: new Date().toISOString()
        })
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className={`mx-auto flex w-full flex-col gap-4 ${embedded ? '' : 'min-h-screen max-w-5xl p-6'}`}>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#7a4b28]">
          <span className="rounded-full bg-[#f5ddc7] px-3 py-1">Coach Mode</span>
          <span>Simple guided flow</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-[#1d140d]">Conversational fitness and nutrition coach</h1>
          <p className="max-w-2xl text-sm text-[#5f5145]">
            Ask in plain language. Steady AI routes you into training, meals, community, reports, or device tracking without
            making you learn the app first.
          </p>
        </div>
        <p className="rounded-2xl border border-[#e4b98f] bg-[#fff4e6] p-3 text-sm text-[#7a4b28]" role="note" aria-live="polite">
          {AGENT_DISCLAIMER}
        </p>
      </header>

      <section aria-label="Starter prompts" className="rounded-[28px] border border-white/60 bg-white/80 p-4 shadow-[0_24px_80px_rgba(80,48,24,0.08)] backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-[#1d140d]">Starter prompts</p>
          <button
            type="button"
            className="rounded-full border border-[#d8c4b3] bg-[#fbf5ef] px-3 py-1 text-xs text-[#5f5145] hover:bg-[#f4eadf]"
            onClick={() => {
              const randomPrompt = STARTER_PROMPTS[Math.floor(Math.random() * STARTER_PROMPTS.length)];
              if (randomPrompt) {
                void sendPrompt(randomPrompt);
              }
            }}
          >
            Surprise me
          </button>
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STARTER_PROMPT_GROUPS.map((group) => {
            const isActive = group.id === activePromptGroup;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => setActivePromptGroup(group.id)}
                className={`rounded-2xl border p-3 text-left transition ${
                  isActive
                    ? 'border-[#1d140d] bg-[#1d140d] text-white'
                    : 'border-[#e6d9cc] bg-white text-[#1d140d] hover:border-[#c4ad98] hover:bg-[#fcf7f1]'
                }`}
              >
                <p className="text-xs font-semibold">{group.label}</p>
                <p className={`mt-1 text-[11px] ${isActive ? 'text-[#f2e8dd]' : 'text-[#77685d]'}`}>{group.description}</p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          {visibleGroup.prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                void sendPrompt(prompt);
              }}
              className="rounded-full border border-[#dccbbb] bg-[#fbf5ef] px-3 py-1 text-xs text-[#4e4035] hover:bg-[#f3e7da]"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Fitness plan', prompt: 'Give me a 30-minute workout plan for today.' },
            { label: 'Nutrition plan', prompt: 'Create a simple 1-day high-protein meal plan.' },
            { label: 'Generate report', prompt: 'Summarize my week and give me one improvement suggestion.' },
            { label: 'Community help', prompt: 'Draft a supportive post for someone rebuilding consistency.' }
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                void sendPrompt(action.prompt);
              }}
              className="rounded-2xl border border-[#dccbbb] bg-[#fffaf5] px-3 py-3 text-left text-xs font-medium text-[#4e4035] hover:bg-[#f7efe6]"
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>

      <section
        className="flex-1 overflow-hidden rounded-[28px] border border-white/60 bg-[#fffdf9]/95 shadow-[0_24px_80px_rgba(80,48,24,0.08)]"
        aria-label="Assistant conversation"
      >
        <ul
          className={`${embedded ? 'max-h-[40vh]' : 'max-h-[55vh]'} space-y-3 overflow-y-auto p-4`}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {messages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <li key={message.id} className="space-y-2">
                <div
                  className={`rounded-3xl border p-4 text-sm ${
                    isUser
                      ? 'ml-auto max-w-[85%] border-[#1d140d] bg-[#1d140d] text-white'
                      : 'max-w-[92%] border-[#eee1d5] bg-[#fcf7f1] text-[#1d140d]'
                  }`}
                >
                  {message.text}
                </div>
                {!isUser && message.routedIntent && message.routedIntent !== 'GENERAL' ? (
                  <p className="max-w-[92%] text-[11px] uppercase tracking-[0.18em] text-[#8b7868]">
                    Suggested area: {message.routedIntent}
                  </p>
                ) : null}
                {message.cards?.length ? (
                  <div className="max-w-[92%] space-y-2">
                    {message.cards.map((card) => (
                      <div
                        key={`${message.id}-${card.id}`}
                        className="rounded-2xl border border-[#eee1d5] bg-white p-3 text-xs text-[#5f5145]"
                      >
                        <p className="font-semibold text-[#1d140d]">{card.title}</p>
                        {card.body ? <p className="mt-1">{card.body}</p> : null}
                        {card.items?.length ? (
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {card.items.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : null}
                        {card.actions?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {card.actions.map((action) => (
                              <button
                                key={`${card.id}-${action.label}`}
                                type="button"
                                className="rounded-full border border-[#dccbbb] bg-[#fbf5ef] px-2 py-1 text-[11px] text-[#4e4035] hover:bg-[#f3e7da]"
                                onClick={() => {
                                  void sendPrompt(action.prompt);
                                }}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Compose message" className="rounded-[28px] border border-white/60 bg-white/80 p-4 shadow-[0_24px_80px_rgba(80,48,24,0.08)]">
        <label htmlFor="assistant-input" className="mb-2 block text-sm font-medium text-[#1d140d]">
          Ask about workouts, meals, reports, community, store options, or syncing data from your phone
        </label>
        <div className="flex gap-2">
          <textarea
            id="assistant-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="min-h-20 w-full rounded-3xl border border-[#dccbbb] bg-[#fffcf8] p-3 text-sm outline-none transition focus:border-[#1d140d]"
            placeholder="Type your question or context"
          />
          <button
            type="button"
            className="h-fit rounded-full bg-[#1d140d] px-5 py-3 text-sm text-white disabled:bg-[#ab9a8c]"
            disabled={!input.trim() || isSending}
            onClick={() => {
              void sendPrompt(input);
            }}
          >
            {isSending ? 'Thinking...' : 'Send'}
          </button>
        </div>
      </section>
    </section>
  );
}

function welcomeMessage(): ChatMessage {
  return {
    id: 'system-assistant-hub',
    role: 'system',
    text: 'Steady AI is ready. Tell me your goal, your meal context, what happened in training, or what data you want to sync from your phone and I will route you.',
    createdAt: new Date().toISOString()
  };
}
