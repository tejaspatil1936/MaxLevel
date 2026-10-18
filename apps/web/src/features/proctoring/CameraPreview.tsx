'use client';

import { Button } from '@mitaoe/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@/i18n';

/**
 * The small self-view on the exam screen (PR-03), so students can position themselves. `Camera preview` collapses it;
 * that only hides the video, and the camera and face detection go on. There is no way to turn the camera off here.
 */
export function CameraPreview({ stream }: { stream: MediaStream | null }) {
  const [open, setOpen] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  const id = useId();
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="secondary" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {t('attempt.cameraPreview')}
      </Button>
      <video
        id={id}
        ref={video}
        hidden={!open}
        muted
        playsInline
        aria-label={t('attempt.cameraView')}
        className="aspect-video w-48 -scale-x-100 rounded-panel border border-rule bg-surface-sunken object-cover"
      />
    </div>
  );
}
