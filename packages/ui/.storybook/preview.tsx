import type { Decorator, Preview } from '@storybook/react-vite';
import './storybook.css';

const THEMES = [
  { name: 'Light', attrs: { 'data-theme': 'light' } },
  { name: 'Dark', attrs: { 'data-theme': 'dark' } },
  { name: 'High contrast', attrs: { 'data-theme': 'light', 'data-contrast': 'high' } },
] as const;

/** Every story renders three times: light, dark and high contrast (UI-14). */
const inAllThemes: Decorator = (Story) => (
  <div style={{ display: 'grid', gap: 16 }}>
    {THEMES.map((t) => (
      <section key={t.name} {...t.attrs} style={{ background: 'var(--sheet)', color: 'var(--ink)', padding: 24 }}>
        <p style={{ margin: '0 0 12px', fontWeight: 700 }}>{t.name}</p>
        <Story />
      </section>
    ))}
  </div>
);

const preview: Preview = {
  decorators: [inAllThemes],
  parameters: { layout: 'fullscreen' },
};

export default preview;
