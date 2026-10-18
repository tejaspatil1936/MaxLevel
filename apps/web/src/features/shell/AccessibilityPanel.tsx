'use client';

import type { Preferences } from '@mitaoe/shared';
import { Button, Dialog, RadioGroup, Switch } from '@mitaoe/ui';
import { Accessibility } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/i18n';
import { usePreferences } from '@/lib/preferences';

const SIZES = [100, 115, 130, 150] as const;

/** The accessibility panel in every top bar (A11Y-01, US-ST-10): each change applies at once and is saved. */
export function AccessibilityButton() {
  const [open, setOpen] = useState(false);
  const { preferences: p, update } = usePreferences();
  return (
    <>
      <Button variant="ghost" aria-label={t('a11y.open')} onClick={() => setOpen(true)} className="min-w-11 px-2">
        <Accessibility aria-hidden size={22} />
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('a11y.open')}
        footer={<Button onClick={() => setOpen(false)}>{t('common.close')}</Button>}
      >
        <div className="flex flex-col gap-5">
          <RadioGroup
            label={t('a11y.textSize')}
            value={String(p.textSize)}
            onValueChange={(v) => update({ textSize: Number(v) as Preferences['textSize'] })}
            options={SIZES.map((s) => ({ value: String(s), label: `${s}%` }))}
          />
          <RadioGroup<Preferences['theme']>
            label={t('a11y.theme')}
            value={p.theme}
            onValueChange={(theme) => update({ theme })}
            options={[
              { value: 'light', label: t('a11y.light') },
              { value: 'dark', label: t('a11y.dark') },
              { value: 'system', label: t('a11y.system') },
            ]}
          />
          <Switch
            label={t('a11y.highContrast')}
            checked={p.highContrast}
            onCheckedChange={(highContrast) => update({ highContrast })}
          />
          <RadioGroup<Preferences['reduceMotion']>
            label={t('a11y.reduceMotion')}
            value={p.reduceMotion}
            onValueChange={(reduceMotion) => update({ reduceMotion })}
            options={[
              { value: 'on', label: t('a11y.on') },
              { value: 'off', label: t('a11y.off') },
              { value: 'system', label: t('a11y.system') },
            ]}
          />
          <Switch
            label={t('a11y.spacing')}
            checked={p.increasedSpacing}
            onCheckedChange={(increasedSpacing) => update({ increasedSpacing })}
          />
          <Switch
            label={t('a11y.ruler')}
            checked={p.readingRuler}
            onCheckedChange={(readingRuler) => update({ readingRuler })}
          />
        </div>
      </Dialog>
    </>
  );
}

/** A band that follows the pointer to help keep the reading line (A11Y-01). Decorative. */
export function ReadingRuler() {
  const { preferences } = usePreferences();
  const [y, setY] = useState(160);
  useEffect(() => {
    if (!preferences.readingRuler) return;
    const move = (e: PointerEvent) => setY(e.clientY);
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [preferences.readingRuler]);
  if (!preferences.readingRuler) return null;
  return (
    <div
      data-testid="reading-ruler"
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-50 h-10 -translate-y-1/2 border-y-2 border-ballpoint bg-highlighter/20"
      style={{ top: y }}
    />
  );
}
