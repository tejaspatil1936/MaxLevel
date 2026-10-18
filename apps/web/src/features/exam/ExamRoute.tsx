'use client';

import { useSearchParams } from 'next/navigation';
import { ExamAttemptRoute } from './ExamAttempt';
import { ExamPreviewRoute } from './ExamPreview';

/** /exam/: a student's attempt with ?attempt=, an admin's preview with ?preview= (Q-13). */
export function ExamRoute() {
  return useSearchParams().has('attempt') ? <ExamAttemptRoute /> : <ExamPreviewRoute />;
}
