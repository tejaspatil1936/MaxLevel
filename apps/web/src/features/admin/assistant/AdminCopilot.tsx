'use client';

import type { AssistantChatMessage, AssistantChatResponse, DiagnosticReport } from '@mitaoe/shared';
import { Button } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Bot, Send, Sparkles, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { AssistantMarkdown } from './AssistantMarkdown';

interface ChatMessage extends AssistantChatMessage {
  id: string;
  diagnostic?: DiagnosticReport | null;
}

let msgCounter = 0;
const createId = (prefix: string) => `${prefix}-${++msgCounter}`;

const INITIAL_MESSAGE: ChatMessage = {
  id: 'init-1',
  role: 'assistant',
  content: `👋 Hello! I am your **MaxLevel Placement Copilot**.\n\nI can help you troubleshoot why tests aren't appearing, explain where to click for live proctoring actions, or summarize drive results.\n\n**Select a common question below or type your issue:**`,
};

export function AdminCopilot({ orgId, testId }: { orgId: string | null; testId?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      return api<AssistantChatResponse>('/v1/admin/assistant/chat', {
        method: 'POST',
        body: {
          messages: updatedMessages,
          context: testId ? { testId } : undefined,
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
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput('');
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
      {/* Floating Action Trigger Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          variant="primary"
          onClick={() => setIsOpen(true)}
          className="group flex h-12 items-center gap-2.5 rounded-full px-4 shadow-lg transition-transform hover:scale-105"
          aria-label={t('assistant.trigger')}
        >
          <Sparkles size={18} className="text-yellow-300 animate-pulse" aria-hidden="true" />
          <span className="font-bold tracking-tight">{t('assistant.trigger')}</span>
          <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold text-white/90">
            {t('assistant.shortcut')}
          </span>
        </Button>
      </div>

      {/* Slide-out Assistant Drawer */}
      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('assistant.title')}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-rule bg-surface shadow-2xl sm:w-[440px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-rule bg-surface px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-control bg-ballpoint text-on-ballpoint shadow-sm">
                <Bot size={20} aria-hidden="true" />
              </div>
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
              <div
                key={m.id}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-panel p-3.5 text-body-small leading-relaxed shadow-sm ${
                    m.role === 'user'
                      ? 'bg-ballpoint text-on-ballpoint'
                      : 'border border-rule bg-sheet text-ink'
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
                            m.diagnostic.isVisibleToStudents
                              ? 'bg-tick/15 text-tick'
                              : 'bg-redpen/15 text-redpen'
                          }`}
                        >
                          {m.diagnostic.isVisibleToStudents
                            ? t('assistant.visible')
                            : t('assistant.hidden')}
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
