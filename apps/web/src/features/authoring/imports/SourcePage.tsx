'use client';

import type { ImportDraft, ImportJobView, ImportPageLink } from '@mitaoe/shared';
import { Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { importJobPath } from './useDraftReview';

/**
 * A kept source page as a `blob:` URL: the signed link is fetched without sign-in (DATA-09), so the image never
 * needs the API's origin in the page's `img-src`. A page kept only as a one-page PDF has no image to show.
 */
function usePageImage(jobId: string, page: number, enabled: boolean) {
  const { orgId } = useWorkspace();
  return useQuery({
    queryKey: qk.orgItem(orgId, 'import-pages', `${jobId}/${page}`),
    queryFn: async () => {
      const link = await api<ImportPageLink>(`${importJobPath(jobId)}/pages/${page}`);
      if (link.contentType !== 'image/png') return null;
      const res = await fetch(link.url);
      if (!res.ok) throw new Error(t('imports.sourceFailed'));
      return URL.createObjectURL(await res.blob());
    },
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * IMP-11: the current draft's source page beside the drafts, with the question's box highlighted on it. It stays in
 * view while the drafts scroll (sticky), and scrolls itself to the highlight.
 */
export function SourcePage({ job, draft }: { job: ImportJobView; draft: ImportDraft | undefined }) {
  const pdf = job.format === 'pdf';
  const page = draft?.sourcePage ?? 1;
  const image = usePageImage(job.id, page, pdf && !!draft);
  const [loaded, setLoaded] = useState<string | null>(null);
  const region = useRef<HTMLElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const src = image.data ?? null;
  const box = draft?.box;
  const shown = !!src && loaded === src;

  // Bring the highlight into the region's view when the page or the box changes.
  useEffect(() => {
    const r = region.current;
    const m = mark.current;
    if (!shown || !r || !m) return;
    const top = m.getBoundingClientRect().top - r.getBoundingClientRect().top + r.scrollTop;
    r.scrollTop = Math.max(0, top - 48);
  }, [shown, box]);

  let body;
  if (!draft) body = null;
  else if (!pdf) body = <p className="text-graphite">{t('imports.sourceNotShown')}</p>;
  else if (image.isError) body = <p className="text-graphite">{t('imports.sourceFailed')}</p>;
  else if (image.data === null) body = <p className="text-graphite">{t('imports.sourceNotShown')}</p>;
  else
    body = (
      <div className="relative">
        {src ? (
          <Image
            src={src}
            alt={t('imports.pageOf', { page: formatCount(page), filename: job.filename })}
            width={0}
            height={0}
            unoptimized
            className="block h-auto w-full border border-rule"
            onLoad={() => setLoaded(src)}
          />
        ) : (
          <Skeleton className="aspect-[1/1.414] w-full" />
        )}
        {shown && box ? (
          <div
            ref={mark}
            data-testid="source-highlight"
            aria-hidden
            className="pointer-events-none absolute border-2 border-ballpoint bg-highlighter/30"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
          />
        ) : null}
      </div>
    );

  return (
    <section
      ref={region}
      aria-labelledby="source-page-heading"
      // Scrollable, so it can take focus and scroll by keyboard.
      tabIndex={0}
      className="flex max-h-[calc(100vh-2rem)] min-w-0 flex-col gap-3 self-start overflow-auto rounded-panel border border-rule bg-surface p-4 lg:sticky lg:top-4"
    >
      <h2 id="source-page-heading" className="text-heading-3 font-bold">
        {t('imports.sourcePage')}
      </h2>
      {body}
    </section>
  );
}
