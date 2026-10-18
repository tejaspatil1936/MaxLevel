import katex from 'katex';
import MarkdownIt, { type MarkdownIt as Parser, type StateBlock, type StateInline } from 'markdown-it';

// Question text (spec 6.1): Markdown with `$…$` and `$$…$$` math through KaTeX's MathML output (A11Y-10) and fenced
// code highlighted by Shiki. Raw HTML is never rendered: markdown-it escapes it, links keep its safe-URL check, and
// Markdown images are off (question images are attached with their alt text instead).

/** Highlights a fenced code block, returning `<pre><code>…</code></pre>` HTML, or null for an unknown language. */
export interface CodeHighlighter {
  highlight(code: string, lang: string): string | null;
}

const DOLLAR = 0x24;
const math = (tex: string, displayMode: boolean) =>
  katex.renderToString(tex, { output: 'mathml', displayMode, throwOnError: false, trust: false, strict: 'ignore' });

/** `$x$` inline and `$$x$$` display math in a paragraph; a `$` next to a space or before a digit is a plain dollar. */
function inlineMath(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== DOLLAR) return false;
  const display = src.charCodeAt(pos + 1) === DOLLAR;
  const open = display ? 2 : 1;
  const close = display ? '$$' : '$';
  const first = src[pos + open];
  if (!first || (!display && /\s/.test(first))) return false;
  let end = pos + open;
  for (;;) {
    end = src.indexOf(close, end);
    if (end < 0) return false;
    if (src[end - 1] !== '\\') break;
    end += 1;
  }
  const tex = src.slice(pos + open, end);
  if (!tex.trim() || (!display && (/\s/.test(tex.at(-1)!) || /\d/.test(src[end + 1] ?? '')))) return false;
  if (!silent) {
    const token = state.push(display ? 'math_display' : 'math_inline', 'math', 0);
    token.content = tex;
  }
  state.pos = end + close.length;
  return true;
}

/** A `$$` block: from a line starting with `$$` to the line ending with `$$`. */
function blockMath(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineText = (n: number) => state.src.slice(state.bMarks[n]! + state.tShift[n]!, state.eMarks[n]);
  const first = lineText(startLine);
  if (!first.startsWith('$$') || state.sCount[startLine]! - state.blkIndent >= 4) return false;
  let body = first.slice(2);
  let line = startLine;
  let closed = body.trimEnd().endsWith('$$');
  while (!closed && ++line < endLine) {
    const text = lineText(line);
    body += `\n${text}`;
    closed = text.trimEnd().endsWith('$$');
  }
  if (!closed) return false;
  if (silent) return true;
  const token = state.push('math_block', 'math', 0);
  token.content = body.trimEnd().slice(0, -2).trim();
  token.map = [startLine, line + 1];
  token.block = true;
  state.line = line + 1;
  return true;
}

function create(highlighter: CodeHighlighter | null): Parser {
  const md = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    highlight: (code, lang) => (lang ? (highlighter?.highlight(code, lang) ?? '') : ''),
  });
  md.disable(['image']);
  md.inline.ruler.after('escape', 'math_inline', inlineMath);
  md.block.ruler.before('fence', 'math_block', blockMath, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.math_inline = (tokens, i) => math(tokens[i]!.content, false);
  md.renderer.rules.math_display = (tokens, i) => math(tokens[i]!.content, true);
  md.renderer.rules.math_block = (tokens, i) => `${math(tokens[i]!.content, true)}\n`;
  return md;
}

const parsers = new WeakMap<CodeHighlighter, Parser>();
let plain: Parser | null = null;

/** Question Markdown as HTML that is safe to insert: no raw HTML, math as MathML, code as `pre code`. */
export function renderQuestionMarkdown(src: string, highlighter: CodeHighlighter | null = null): string {
  if (!highlighter) return (plain ??= create(null)).render(src);
  let md = parsers.get(highlighter);
  if (!md) parsers.set(highlighter, (md = create(highlighter)));
  return md.render(src);
}

/** True when the text has a fenced code block, so the highlighter is worth loading. */
export const hasCodeBlock = (src: string) => /^ {0,3}(```|~~~)/m.test(src);
