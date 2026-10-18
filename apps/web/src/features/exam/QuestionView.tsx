'use client';

import { cx } from '@mitaoe/ui';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { hasCodeBlock, renderQuestionMarkdown, type CodeHighlighter } from './markdown';

// The question as students see it (spec 6.1, 13.6): the editor's Student view and the exam screen render through
// these components, so the preview is exactly what students get.

let loaded: CodeHighlighter | null = null;
let loading: Promise<CodeHighlighter> | null = null;

/** Shiki, loaded on first use only when some text has a code block; null until it is ready. */
function useCodeHighlighter(needed: boolean): CodeHighlighter | null {
  const [highlighter, setHighlighter] = useState(loaded);
  useEffect(() => {
    if (!needed || highlighter) return;
    let live = true;
    loading ??= import('./highlighter').then((m) => m.createCodeHighlighter());
    loading
      .then((h) => {
        loaded = h;
        if (live) setHighlighter(h);
      })
      // Without the highlighter, code still shows as plain `pre code`.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [needed, highlighter]);
  return highlighter;
}

/** Question Markdown: math as MathML, code highlighted, never raw HTML (A11Y-10). */
export function QuestionText({ text, className }: { text: string; className?: string }) {
  const highlighter = useCodeHighlighter(hasCodeBlock(text));
  const html = useMemo(() => renderQuestionMarkdown(text, highlighter), [text, highlighter]);
  return (
    <div
      className={cx(
        'min-w-0 break-words [&_code]:font-mono [&_p+p]:mt-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre]:text-body-small',
        className,
      )}
      // Safe: renderQuestionMarkdown escapes raw HTML, and KaTeX and Shiki escape what they output.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export interface QuestionViewImage {
  /** A data or signed URL; null while it is not available. */
  src: string | null;
  alt: string;
}

export const optionLetter = (i: number) => String.fromCharCode(65 + i);

/** Prompt, images (named by their alt text) and lettered option rows, as on the exam sheet. */
export function QuestionView({
  prompt,
  images,
  options,
}: {
  prompt: string;
  images: readonly QuestionViewImage[];
  options: ReadonlyArray<{ id: string; text: string }>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <QuestionText text={prompt} className="max-w-question text-question" />
      {images.map((img, i) =>
        img.src ? (
          // Data or signed URLs, shown at their own size (the static export does not optimise images).
          <Image
            key={i}
            src={img.src}
            alt={img.alt}
            width={0}
            height={0}
            unoptimized
            className="h-auto max-h-80 w-auto max-w-full self-start border border-rule"
          />
        ) : null,
      )}
      <ol className="flex flex-col gap-2">
        {options.map((o, i) => (
          <li
            key={o.id}
            className="flex min-h-14 items-center gap-3 rounded-control border border-rule bg-surface px-3 py-2"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-dropout font-bold">
              {optionLetter(i)}
            </span>
            <QuestionText text={o.text} />
          </li>
        ))}
      </ol>
    </div>
  );
}
