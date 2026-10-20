import type { Preferences } from '@mitaoe/shared';

// Not a client module: the root layout (a server component) inlines the boot script below.
export const PREFERENCES_KEY = 'mitaoe.preferences';

/**
 * Applies preferences to <html> as data attributes that tokens.css reads. The same function runs, as a string, in the
 * inline script that applies the cached copy before first paint (A11Y-02).
 */
export function applyPreferences(p: Preferences): void {
  const html = document.documentElement;
  html.dataset.theme = p.theme;
  html.dataset.motion = p.reduceMotion === 'on' ? 'reduce' : p.reduceMotion === 'off' ? 'allow' : 'system';
  html.dataset.textSize = String(p.textSize);
  if (p.highContrast) html.dataset.contrast = 'high';
  else delete html.dataset.contrast;
  if (p.increasedSpacing) html.dataset.spacing = 'increased';
  else delete html.dataset.spacing;
  if (p.readingRuler) html.dataset.ruler = 'on';
  else delete html.dataset.ruler;
}

/** Runs before the app's JavaScript: reads the cached preferences and applies them (no flash of the wrong theme). */
export const PREFERENCES_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFERENCES_KEY)})||'null');if(!p)return;(${applyPreferences.toString()})(p);}catch(e){}})();`;
