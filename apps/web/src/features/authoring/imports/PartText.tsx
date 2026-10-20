import type { Ref } from 'react';
import { findQuestion } from './source-text';

/**
 * A part's text with the question's text in a `mark` when the part holds it. Everything is a React text node: the
 * file's content is never parsed as HTML.
 */
export function PartText({ text, prompt, markRef }: { text: string; prompt: string; markRef: Ref<HTMLElement> }) {
  const at = findQuestion(text, prompt);
  return (
    <p className="whitespace-pre-wrap break-words font-code text-body-small">
      {at ? (
        <>
          {text.slice(0, at.start)}
          <mark ref={markRef} className="bg-highlighter text-highlighter-ink">
            {text.slice(at.start, at.end)}
          </mark>
          {text.slice(at.end)}
        </>
      ) : (
        text
      )}
    </p>
  );
}
