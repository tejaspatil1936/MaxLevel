'use client';

import type {
  AssistantActionProposal,
  AssistantChatMessage,
  AssistantChatResponse,
  DiagnosticReport,
} from '@mitaoe/shared';
import { Button } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Maximize2, Minimize2, Send, Sparkles, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { MaxLevelLogo } from '../../shell/MaxLevelLogo';
import { ActionProposalCard } from './ActionProposalCard';
import { AssistantMarkdown } from './AssistantMarkdown';

type ButtonMode = 'full' | 'compact' | 'hidden';

interface ChatMessage extends AssistantChatMessage {
  id: string;
  diagnostic?: DiagnosticReport | null;
  proposal?: AssistantActionProposal | null;
}

let msgCounter = 0;
const createId = (prefix: string) => `${prefix}-${++msgCounter}`;

const INITIAL_MESSAGE: ChatMessage = {
  id: 'init-1',
  role: 'assistant',
  content: `👋 Hello! I am your **MaxLevel Placement Copilot**.\n\nI can help you troubleshoot why tests aren't appearing, explain where to click for live proctoring actions, or summarize drive results.\n\n**Select a common question below or type your issue:**`,
};

export function AdminCopilot({
  orgId,
  testId: propTestId,
  seriesId: propSeriesId,
}: {
  orgId: string | null;
  testId?: string;
  seriesId?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Automatically detect active test or series from URL search parameters
  const queryId = searchParams.get('id') ?? searchParams.get('test') ?? searchParams.get('testId');
  const isSeriesRoute = pathname?.includes('/series');
  const activeTestId = propTestId ?? (!isSeriesRoute ? (queryId ?? undefined) : undefined);
  const activeSeriesId = propSeriesId ?? (isSeriesRoute ? (queryId ?? undefined) : undefined);

  const [isOpen, setIsOpen] = useState(false);
  const [btnMode, setBtnMode] = useState<ButtonMode>(() => {
    if (typeof window === 'undefined') return 'compact';
    try {
      const saved = localStorage.getItem('maxlevel_copilot_mode') as ButtonMode;
      if (saved === 'full' || saved === 'compact' || saved === 'hidden') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'compact';
  });
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('maxlevel_copilot_expanded') === 'true';
    } catch {
      return false;
    }
  });

  const toggleExpanded = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('maxlevel_copilot_expanded', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const updateBtnMode = (newMode: ButtonMode) => {
    setBtnMode(newMode);
    try {
      localStorage.setItem('maxlevel_copilot_mode', newMode);
    } catch {
      // ignore
    }
  };

  // Keyboard shortcut: Ctrl + Shift + A to toggle assistant
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages]);

  const chatMutation = useMutation({
    mutationFn: (userText: string) => {
      const updatedMessages: AssistantChatMessage[] = [
        ...messages.map(({ role, content }) => ({ role, content })),
        { role: 'user', content: userText },
      ];
      const context =
        activeTestId || activeSeriesId
          ? {
              ...(activeTestId ? { testId: activeTestId } : {}),
              ...(activeSeriesId ? { seriesId: activeSeriesId } : {}),
            }
          : undefined;

      return api<AssistantChatResponse>('/v1/admin/assistant/chat', {
        method: 'POST',
        body: {
          messages: updatedMessages,
          context,
        },
      });
    },
    onSuccess: (data, userText) => {
      const userMsg: ChatMessage = {
        id: createId('user'),
        role: 'user',
        content: userText,
      };
      const assistantMsg: ChatMessage = {
        id: createId('asst'),
        role: 'assistant',
        content: data.reply,
        diagnostic: data.diagnostic,
        proposal: data.proposal,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput('');
    },
    onError: (err: unknown) => {
      const errObj = err as { status?: number; code?: string } | undefined;
      const isRateLimit = errObj?.status === 429 || errObj?.code === 'RATE_LIMITED';
      const content = isRateLimit ? t('assistant.rateLimited') : t('assistant.error');
      const errorMsg: ChatMessage = {
        id: createId('err'),
        role: 'assistant',
        content: `⚠️ **${content}**`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    },
  });

  const handleSend = (textToSend?: string) => {
    const query = (textToSend ?? input).trim();
    if (!query || chatMutation.isPending) return;

    // Optimistically show user message
    const tempUserMsg: ChatMessage = {
      id: createId('user-temp'),
      role: 'user',
      content: query,
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setInput('');
    chatMutation.mutate(query);
  };

  const clearChat = () => {
    setMessages([INITIAL_MESSAGE]);
    setInput('');
  };

  if (!orgId) return null;

  return (
    <>
      {/* Floating Action Trigger Button (Hidden when Drawer is Open) */}
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-40">
          {btnMode === 'full' && (
            <div className="flex items-center shadow-lg rounded-full bg-ballpoint text-on-ballpoint overflow-hidden transition-all duration-200 hover:shadow-xl hover:scale-102">
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="flex h-11 items-center gap-2 pl-4 pr-2 font-bold tracking-tight text-on-ballpoint hover:opacity-90"
                aria-label={t('assistant.trigger')}
              >
                <Sparkles size={16} className="text-yellow-300 animate-pulse" aria-hidden="true" />
                <span className="text-sm font-semibold">{t('assistant.trigger')}</span>
                <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold text-on-ballpoint">
                  {t('assistant.shortcut')}
                </span>
              </button>
              <div className="flex items-center border-l border-white/20 pr-1 pl-0.5">
                <button
                  type="button"
                  onClick={() => updateBtnMode('compact')}
                  title={t('assistant.minimize')}
                  aria-label={t('assistant.minimize')}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-on-ballpoint/70 hover:text-on-ballpoint hover:bg-white/20 transition-colors"
                >
                  <Minimize2 size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => updateBtnMode('hidden')}
                  title={t('assistant.hide')}
                  aria-label={t('assistant.hide')}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-on-ballpoint/70 hover:text-on-ballpoint hover:bg-white/20 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {btnMode === 'compact' && (
            <div className="relative group flex items-center">
              {/* Hover bridge & action popup to the left of the button (seamless hover, zero dead gap) */}
              <div className="absolute right-full top-1/2 -translate-y-1/2 pr-2.5 hidden group-hover:flex items-center z-10 before:absolute before:inset-y-0 before:-right-3 before:w-4">
                <div className="flex items-center gap-1.5 rounded-full bg-surface border border-rule px-2.5 py-1 shadow-md whitespace-nowrap">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateBtnMode('full');
                    }}
                    title={t('assistant.expand')}
                    className="text-[11px] font-medium text-graphite hover:text-ink hover:bg-surface-sunken px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors"
                  >
                    <Maximize2 size={12} />
                    <span>{t('assistant.expand')}</span>
                  </button>
                  <span className="text-rule">{'|'}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateBtnMode('hidden');
                    }}
                    title={t('assistant.hide')}
                    className="text-[11px] font-medium text-graphite hover:text-redpen hover:bg-surface-sunken px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors"
                  >
                    <X size={12} />
                    <span>{t('assistant.hide')}</span>
                  </button>
                </div>
              </div>

              {/* Main Circular Floating Trigger Button */}
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                title={`${t('assistant.trigger')} (${t('assistant.shortcut')})`}
                aria-label={t('assistant.trigger')}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-ballpoint text-on-ballpoint shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <Sparkles size={18} className="text-yellow-300 animate-pulse" aria-hidden="true" />
              </button>
            </div>
          )}

          {btnMode === 'hidden' && (
            <div className="fixed bottom-6 right-0">
              <button
                type="button"
                onClick={() => updateBtnMode('compact')}
                title={`${t('assistant.showButton')} (${t('assistant.shortcut')})`}
                aria-label={t('assistant.showButton')}
                className="flex h-7 items-center gap-1 rounded-l-md bg-ballpoint/75 hover:bg-ballpoint text-on-ballpoint px-2 shadow transition-all opacity-40 hover:opacity-100"
              >
                <Sparkles size={13} className="text-yellow-300" />
                <span className="text-[10px] font-semibold">{'AI'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Slide-out Assistant Drawer */}
      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('assistant.title')}
          className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-rule bg-surface shadow-2xl transition-all duration-300 ease-standard ${
            isExpanded ? 'sm:w-[720px] lg:w-[860px]' : 'sm:w-[440px]'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-rule bg-surface px-4 py-3">
            <div className="flex items-center gap-2.5">
              <MaxLevelLogo size={32} />
              <div className="flex flex-col">
                <span className="font-display text-heading-3 font-bold text-ink leading-tight">
                  {t('assistant.title')}
                </span>
                <span className="text-[11px] font-semibold text-graphite uppercase tracking-wider">
                  {t('assistant.subtitle')}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                onClick={toggleExpanded}
                title={isExpanded ? t('assistant.minimizeDrawer') : t('assistant.expandDrawer')}
                aria-label={isExpanded ? t('assistant.minimizeDrawer') : t('assistant.expandDrawer')}
                className="text-graphite hover:text-ink"
              >
                {isExpanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
              </Button>
              <Button
                variant="ghost"
                onClick={clearChat}
                title={t('assistant.clear')}
                className="text-graphite hover:text-redpen"
              >
                <Trash2 size={16} aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => setIsOpen(false)}
                aria-label={t('assistant.close')}
                className="text-graphite"
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
          </div>

          {/* Chat Messages Scroll Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[90%] rounded-panel p-3.5 text-body-small leading-relaxed shadow-sm ${
                    m.role === 'user' ? 'bg-ballpoint text-on-ballpoint' : 'border border-rule bg-sheet text-ink'
                  }`}
                >
                  {m.role === 'user' ? (
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  ) : (
                    <AssistantMarkdown content={m.content} />
                  )}

                  {/* Render Diagnostic summary card if available */}
                  {m.diagnostic ? (
                    <div className="mt-3 rounded-control border border-rule bg-surface p-3 text-ink">
                      <div className="flex items-center justify-between border-b border-rule pb-2">
                        <span className="font-bold text-heading-3">{m.diagnostic.testTitle}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            m.diagnostic.isVisibleToStudents ? 'bg-tick/15 text-tick' : 'bg-redpen/15 text-redpen'
                          }`}
                        >
                          {m.diagnostic.isVisibleToStudents ? t('assistant.visible') : t('assistant.hidden')}
                        </span>
                      </div>

                      <div className="mt-2 space-y-1.5 text-[12px]">
                        {m.diagnostic.checks.map((chk) => (
                          <div key={chk.name} className="flex items-center justify-between">
                            <span className="text-graphite">{chk.name}</span>
                            <span
                              className={`font-semibold ${
                                chk.status === 'passed'
                                  ? 'text-tick'
                                  : chk.status === 'failed'
                                    ? 'text-redpen'
                                    : 'text-highlighter'
                              }`}
                            >
                              {chk.detail}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Direct Action Link if critical issue exists */}
                      {m.diagnostic.issues.length > 0 &&
                      m.diagnostic.issues[0]?.actionHref &&
                      m.diagnostic.issues[0]?.actionLabel ? (
                        <div className="mt-3 border-t border-rule pt-2">
                          <Link
                            href={m.diagnostic.issues[0].actionHref}
                            className="inline-flex items-center gap-1 font-bold text-ballpoint underline text-caption"
                          >
                            <span>{m.diagnostic.issues[0].actionLabel}</span>
                            <ArrowRight size={12} aria-hidden="true" />
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Render Action Proposal Card if available */}
                  {m.proposal ? <ActionProposalCard proposal={m.proposal} /> : null}
                </div>
              </div>
            ))}

            {chatMutation.isPending ? (
              <div className="flex items-center gap-2 text-caption text-graphite p-2 animate-pulse">
                <Sparkles size={14} className="text-ballpoint" aria-hidden="true" />
                <span>{t('assistant.diagnosing')}</span>
              </div>
            ) : null}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompt Suggestions */}
          <div className="border-t border-rule bg-surface-sunken p-2.5">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleSend(t('assistant.quickPrompt1'))}
                className="rounded-full border border-rule bg-surface px-2.5 py-1 text-[11px] font-semibold text-graphite hover:border-ballpoint hover:text-ballpoint"
              >
                {t('assistant.quickPrompt1')}
              </button>
              <button
                type="button"
                onClick={() => handleSend(t('assistant.quickPrompt2'))}
                className="rounded-full border border-rule bg-surface px-2.5 py-1 text-[11px] font-semibold text-graphite hover:border-ballpoint hover:text-ballpoint"
              >
                {t('assistant.quickPrompt2')}
              </button>
              <button
                type="button"
                onClick={() => handleSend(t('assistant.quickPrompt3'))}
                className="rounded-full border border-rule bg-surface px-2.5 py-1 text-[11px] font-semibold text-graphite hover:border-ballpoint hover:text-ballpoint"
              >
                {t('assistant.quickPrompt3')}
              </button>
              <button
                type="button"
                onClick={() => handleSend(t('assistant.quickPrompt4'))}
                className="rounded-full border border-rule bg-surface px-2.5 py-1 text-[11px] font-semibold text-graphite hover:border-ballpoint hover:text-ballpoint"
              >
                {t('assistant.quickPrompt4')}
              </button>
            </div>
          </div>

          {/* Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2 border-t border-rule bg-surface p-3"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('assistant.placeholder')}
              disabled={chatMutation.isPending}
              className="flex-1 rounded-control border border-rule bg-sheet px-3 py-2 text-body-small text-ink placeholder:text-graphite focus:outline-none focus:ring-2 focus:ring-ballpoint"
            />
            <Button
              type="submit"
              disabled={!input.trim() || chatMutation.isPending}
              aria-label={t('assistant.send')}
              className="h-10 w-10 p-0 justify-center shrink-0"
            >
              <Send size={16} aria-hidden="true" />
            </Button>
          </form>
        </div>
      ) : null}
    </>
  );
}
