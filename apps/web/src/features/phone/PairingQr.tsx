import { t } from '@/i18n';
import { qrPath } from './pairing-qr';

/**
 * The pairing link's QR code (PR-13), named for screen readers. It is always drawn dark on white (the light theme's
 * ink and surface) whatever the theme, because phone cameras read inverted codes poorly.
 */
export function PairingQr({ url }: { url: string }) {
  const { size, d } = qrPath(url);
  return (
    <div data-theme="light" className="w-fit rounded-panel border border-rule bg-surface p-2">
      <svg
        role="img"
        aria-label={t('pairing.qr')}
        viewBox={`0 0 ${size} ${size}`}
        className="size-48 fill-ink"
        shapeRendering="crispEdges"
      >
        <path d={d} />
      </svg>
    </div>
  );
}
