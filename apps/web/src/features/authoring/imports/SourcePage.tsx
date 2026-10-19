'use client';

import type { ImportDraft, ImportJobView, ImportPageLink, ImportPartText } from '@mitaoe/shared';
import { Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { useEffect, useRef, useState, type Ref } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { showBlob, signedBlob } from '@/lib/files';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { draftSourceLabel } from './DraftArticle';
import { PartText } from './PartText';
import { importJobPath } from './useDraftReview';

/**
 * A kept source page's image: the signed link is fetched without sign-in (DATA-09) and shown through a `blob:` URL, so
 * the image never needs the API's origin in the page's `img-src`. A page kept only as a one-page PDF has no image to
 * show. The blob stays cached while the review page is open; its URL is made and revoked by the component showing it.
 */
function usePageImage(jobId: string, page: number, enabled: boolean) {
  const { orgId } = useWorkspace();
  return useQuery({
    queryKey: qk.orgItem(orgId, 'import-pages', `${jobId}/${page}`),
    queryFn: async () => {
      const link = await api<ImportPageLink>(`${importJobPath(jobId)}/pages/${page}`);
      if (link.contentType !== 'image/png') return null;
      return signedBlob(link.url);
    },
    enabled,
    staleTime: Infinity,
  });
}

/** The text the worker kept of a TXT, MD or sheet part (or template row); null when none was kept. */
function usePartText(jobId: string, part: number, enabled: boolean) {
  const { orgId } = useWorkspace();
  return useQuery({
    queryKey: qk.orgItem(orgId, 'import-parts', `${jobId}/${part}`),
    queryFn: async () => {
      try {
        return await api<ImportPartText>(`${importJobPath(jobId)}/parts/${part}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
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
  const textual = !pdf && job.format !== 'json';
  const page = draft?.sourcePage ?? 1;
  const image = usePageImage(job.id, page, pdf && !!draft);
  const part = usePartText(job.id, page, textual && !!draft);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => showBlob(image.data, setSrc), [image.data]);
  const region = useRef<HTMLElement>(null);
  const mark = useRef<HTMLElement>(null);
  const box = draft?.box;
  const shown = (!!src && loaded === src) || !!part.data;

  // Bring the highlight (or the marked question) into the region's view when the page or the question changes.
  useEffect(() => {
    const r = region.current;
    const m = mark.current;
    if (!shown || !r || !m) return;
    const top = m.getBoundingClientRect().top - r.getBoundingClientRect().top + r.scrollTop;
    r.scrollTop = Math.max(0, top - 48);
  }, [shown, box, part.data, draft?.prompt]);

  let body;
  if (!draft) body = null;
  else if (job.format === 'json') body = <p className="text-graphite">{t('imports.sourceJson')}</p>;
  else if (textual) {
    const label = draftSourceLabel(job, page);
    if (part.isError) body = <p className="text-graphite">{t('imports.sourceFailed')}</p>;
    else if (part.data === null) body = <p className="text-graphite">{t('imports.sourceTextMissing')}</p>;
    else if (!part.data) body = <Skeleton className="h-40 w-full" />;
    else
      body = (
        <>
          {label ? (
            <p className="text-body-small text-graphite">
              {t('imports.partOf', { part: label, filename: job.filename })}
            </p>
          ) : null}
          <PartText text={part.data.text} prompt={draft.prompt} markRef={mark} />
          {part.data.truncated ? <p className="text-body-small text-graphite">{t('imports.sourceTruncated')}</p> : null}
        </>
      );
  } else if (image.isError) body = <p className="text-graphite">{t('imports.sourceFailed')}</p>;
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
            ref={mark as Ref<HTMLDivElement>}
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
