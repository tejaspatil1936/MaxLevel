'use client';

import { cx } from '@mitaoe/ui';
import Image from 'next/image';
import { t } from '@/i18n';

export interface MaxLevelLogoProps {
  /** Size in pixels (sets both width and height for square logo mark). Default is 32. */
  size?: number;
  /** Custom width in pixels */
  width?: number;
  /** Custom height in pixels */
  height?: number;
  /** Optional theme override: 'light' forces dark logo (for light bg), 'dark' forces white logo (for dark bg) */
  forceTheme?: 'light' | 'dark';
  /** Extra CSS classes */
  className?: string;
  /** Accessible alt text. Defaults to "MaxLevel" */
  alt?: string;
  /** Whether to render the brand wordmark "MaxLevel" next to the logo icon */
  withWordmark?: boolean;
}

export function MaxLevelLogo({
  size = 32,
  width,
  height,
  forceTheme,
  className,
  alt = 'MaxLevel',
  withWordmark = false,
}: MaxLevelLogoProps) {
  const w = width ?? size;
  const h = height ?? size;

  const logoIcon = (
    <span
      className={cx('relative inline-flex shrink-0 items-center justify-center select-none', className)}
      style={{ width: w, height: h }}
    >
      {forceTheme === 'light' ? (
        <Image
          src="/MaxLevel-Dark.png"
          alt={alt}
          width={w}
          height={h}
          priority
          className="h-full w-full object-contain"
        />
      ) : forceTheme === 'dark' ? (
        <Image
          src="/MaxLevel-Light.png"
          alt={alt}
          width={w}
          height={h}
          priority
          className="h-full w-full object-contain"
        />
      ) : (
        <>
          <Image
            src="/MaxLevel-Dark.png"
            alt={alt}
            width={w}
            height={h}
            priority
            className="maxlevel-logo-light-bg h-full w-full object-contain"
          />
          <Image
            src="/MaxLevel-Light.png"
            alt={alt}
            width={w}
            height={h}
            priority
            className="maxlevel-logo-dark-bg h-full w-full object-contain"
          />
        </>
      )}
    </span>
  );

  if (!withWordmark) {
    return logoIcon;
  }

  return (
    <div className="inline-flex items-center gap-2.5">
      {logoIcon}
      <span className="font-display text-heading-2 font-extrabold tracking-tight text-ink leading-none">
        {t('app.name')}
      </span>
    </div>
  );
}
