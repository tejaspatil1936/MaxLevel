'use client';

import MarkdownIt from 'markdown-it';
import { useMemo } from 'react';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

export function AssistantMarkdown({ content, className = '' }: { content: string; className?: string }) {
  const html = useMemo(() => md.render(content), [content]);

  return (
    <div
      className={`min-w-0 break-words leading-relaxed [&_h1]:text-heading-2 [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-heading-3 [&_h2]:font-bold [&_h2]:my-2 [&_h3]:text-body-small [&_h3]:font-bold [&_h3]:text-ink [&_h3]:my-2 [&_h4]:text-caption [&_h4]:font-bold [&_h4]:text-graphite [&_h4]:my-1.5 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-bold [&_strong]:text-ink [&_a]:font-bold [&_a]:text-ballpoint [&_a]:underline [&_a]:hover:opacity-80 [&_code]:rounded [&_code]:bg-surface-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-sunken [&_pre]:p-2.5 [&_blockquote]:border-l-2 [&_blockquote]:border-ballpoint [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-graphite ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
