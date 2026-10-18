import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { CodeHighlighter } from './markdown';

// Shiki with the JavaScript regex engine (no WebAssembly) and the languages placement questions use. Token colours are
// the design tokens, so code follows light, dark and high contrast and keeps their contrast (UI-01, 13.4).
const THEME = 'question-code';
const theme = createCssVariablesTheme({
  name: THEME,
  variablePrefix: '--code-',
  fontStyle: true,
  variableDefaults: {
    foreground: 'var(--ink)',
    background: 'var(--surface-sunken)',
    'token-constant': 'var(--ballpoint)',
    'token-string': 'var(--tick)',
    'token-comment': 'var(--graphite)',
    'token-keyword': 'var(--redpen)',
    'token-parameter': 'var(--ink)',
    'token-function': 'var(--ballpoint)',
    'token-string-expression': 'var(--tick)',
    'token-punctuation': 'var(--ink)',
    'token-link': 'var(--ballpoint)',
  },
});

export async function createCodeHighlighter(): Promise<CodeHighlighter> {
  const shiki = await createHighlighterCore({
    themes: [theme],
    langs: [
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/python.mjs'),
      import('shiki/langs/java.mjs'),
      import('shiki/langs/c.mjs'),
      import('shiki/langs/cpp.mjs'),
      import('shiki/langs/sql.mjs'),
      import('shiki/langs/shellscript.mjs'),
      import('shiki/langs/json.mjs'),
    ],
    engine: createJavaScriptRegexEngine(),
  });
  const known = new Set(shiki.getLoadedLanguages());
  return {
    highlight(code, lang) {
      const name = lang.trim().toLowerCase();
      return known.has(name) ? shiki.codeToHtml(code.replace(/\n$/, ''), { lang: name, theme: THEME }) : null;
    },
  };
}
