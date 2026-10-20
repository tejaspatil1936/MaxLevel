/**
 * Where a draft's question is in the text of its source part (IMP-11): the prompt as stored, else without its outer
 * whitespace; null when the part does not hold it (the model may have left out numbering inside it).
 */
export function findQuestion(text: string, prompt: string): { start: number; end: number } | null {
  for (const needle of [prompt, prompt.trim()]) {
    if (needle.trim() === '') continue;
    const at = text.indexOf(needle);
    if (at >= 0) return { start: at, end: at + needle.length };
  }
  return null;
}
