import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PartText } from './PartText';

describe('PartText', () => {
  it('IMP-11 shows the part with the question in a mark, the file content as text, never as HTML', () => {
    const text = 'Q: <img src=x onerror="alert(1)"> What is <b>2 + 2</b>?\nAnswer: 4';
    const html = renderToStaticMarkup(
      <PartText text={text} prompt='<img src=x onerror="alert(1)"> What is <b>2 + 2</b>?' markRef={null} />,
    );
    expect(html).toBe(
      '<p class="whitespace-pre-wrap break-words font-code text-body-small">Q: ' +
        '<mark class="bg-highlighter text-highlighter-ink">&lt;img src=x onerror=&quot;alert(1)&quot;&gt; What is ' +
        '&lt;b&gt;2 + 2&lt;/b&gt;?</mark>\nAnswer: 4</p>',
    );
  });

  it('IMP-11 shows the whole part unmarked when the question is not in it', () => {
    const html = renderToStaticMarkup(<PartText text="Q: Largest planet?" prompt="Smallest?" markRef={null} />);
    expect(html).not.toContain('<mark');
    expect(html).toContain('Q: Largest planet?');
  });
});
