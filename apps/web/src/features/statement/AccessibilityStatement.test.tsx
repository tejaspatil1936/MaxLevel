import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { config } from '@/lib/config';
import { AccessibilityStatement } from './AccessibilityStatement';

const html = renderToStaticMarkup(<AccessibilityStatement />);
const text = html.replace(/<[^>]+>/g, ' ');

/** The inner HTML of the section labelled by the heading with this id. */
function section(id: string): string {
  const m = new RegExp(`<section aria-labelledby="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html);
  expect(m, `section ${id}`).not.toBeNull();
  return m![1]!;
}

describe('AccessibilityStatement', () => {
  it('A11Y-22 has one level-1 heading and the four sections in order, each labelled by its level-2 heading', () => {
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.match(/<h1[^>]*>([^<]*)<\/h1>/)![1]).toBe('Accessibility statement');
    const headings = [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([^<]*)<\/h2>/g)].map((m) => [m[1], m[2]]);
    expect(headings).toEqual([
      ['statement-standard', 'Standard'],
      ['statement-gaps', 'Known gaps'],
      ['statement-timed', 'Timed exams'],
      ['statement-contact', 'Contact'],
    ]);
  });

  it('A11Y-22 names the standard and lists the unbuilt assistive-technology and camera accommodations as gaps', () => {
    expect(section('statement-standard')).toContain('WCAG 2.2 level AA');
    const items = [...section('statement-gaps').matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]!.toLowerCase());
    expect(items.some((i) => ['screen reader', 'magnifier', 'strike'].every((w) => i.includes(w)))).toBe(true);
    expect(items.some((i) => i.includes('camera'))).toBe(true);
  });

  it('A11Y-18 the timed-exam section carries the real-time exception and the extra-time and accommodation routes', () => {
    const timed = section('statement-timed');
    for (const words of [/WCAG/, /real-time/i, /extra time/i, /accommodation/i]) expect(timed).toMatch(words);
  });

  it('A11Y-22 the contact is a mailto link named by its address, and points exam help to the placement cell', () => {
    const contact = section('statement-contact');
    expect(config.accessibilityEmail).toMatch(/^[^\s@?]+@[^\s@?]+\.[^\s@?]+$/);
    expect(contact).toMatch(
      new RegExp(`<a href="mailto:${config.accessibilityEmail}"[^>]*>${config.accessibilityEmail}</a>`),
    );
    expect(contact).toMatch(/placement cell/i);
    expect(text).not.toMatch(/undefined/);
  });
});
