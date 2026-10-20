import { describe, expect, it } from 'vitest';
import { createCodeHighlighter } from './highlighter';
import { hasCodeBlock, renderQuestionMarkdown } from './markdown';

describe('question markdown', () => {
  it('A11Y-10 inline and display math render as KaTeX MathML with the TeX source as annotation', () => {
    const html = renderQuestionMarkdown('If $x + 3 = 7$, what is $x$?\n\n$$\n\\frac{a}{b}\n$$');
    expect(html.match(/<math/g)).toHaveLength(3);
    expect(html).toContain('<annotation encoding="application/x-tex">x + 3 = 7</annotation>');
    expect(html).toContain('display="block"');
    expect(html).not.toContain('katex-html');
  });

  it('Q-01 a dollar amount or an escaped dollar stays text', () => {
    const html = renderQuestionMarkdown('It costs $5 and $10, or \\$x\\$.');
    expect(html).not.toContain('<math');
    expect(html).toContain('$5 and $10');
  });

  it('Q-01 raw HTML, script links and Markdown images are never rendered', () => {
    const html = renderQuestionMarkdown(
      '<img src=x onerror=alert(1)> [x](javascript:alert(1)) ![pic](https://example.com/a.png) <script>1</script>',
    );
    expect(html).not.toMatch(/<img|<script|href="javascript/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('Q-01 fenced code is a pre code block, highlighted with design-token colours when the language is known', async () => {
    const src = '```js\nconst x = 7 - 3;\n```';
    expect(hasCodeBlock(src)).toBe(true);
    expect(hasCodeBlock('No code here')).toBe(false);
    expect(renderQuestionMarkdown(src)).toMatch(/<pre><code class="language-js">const x = 7 - 3;\n<\/code><\/pre>/);
    const highlighted = renderQuestionMarkdown(src, await createCodeHighlighter());
    expect(highlighted).toMatch(/^<pre class="shiki question-code"[^>]*><code>/);
    expect(highlighted).toContain('var(--code-token-keyword, var(--redpen))');
    expect(highlighted.replace(/<[^>]+>/g, '')).toContain('const x = 7 - 3;');
    const unknown = renderQuestionMarkdown('```brainfuck\n+-<>\n```', await createCodeHighlighter());
    expect(unknown).toContain('<pre><code class="language-brainfuck">+-&lt;&gt;');
  });
});
