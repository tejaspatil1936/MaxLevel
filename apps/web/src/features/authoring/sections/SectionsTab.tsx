'use client';

import type { Section, TestDetail } from '@mitaoe/shared';
import { Button, ConfirmDialog, EmptyState, InlineMessage, Menu, notify, Skeleton, Table } from '@mitaoe/ui';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { formatCount } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';
import { useQuestions } from '../questions/useQuestions';
import { drawText, durationText, mixText, moved } from './section-draft';
import { SectionDialog } from './SectionDialog';
import { useSaveSections } from './useSaveSections';
import { WholeTestDraw } from './WholeTestDraw';

/** Where focus goes once the list shows a change: a section's menu button, or `Add section` when none is left. */
type FocusTarget = { id: string } | 'add' | null;

/**
 * Q-03, Q-05, US-AD-07: the test's sections with their pools, draws and mixes; add, edit, reorder and delete them.
 * Without sections the whole test is one pool, with its own draw.
 */
export function SectionsTab({ test }: { test: TestDetail }) {
  const { readOnly } = useWorkspace();
  const questions = useQuestions(test.id);
  const save = useSaveSections(test);
  // `null`: closed; `{}`: adding; `{ section }`: editing.
  const [editing, setEditing] = useState<{ section?: Section } | null>(null);
  const [deleting, setDeleting] = useState<Section | null>(null);
  const [focus, setFocus] = useState<FocusTarget>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const sections = [...test.sections].sort((a, b) => a.order - b.order);

  // After a move or delete the row's button may have moved or gone; put focus somewhere sensible (A11Y-05). The frame
  // lets a closing menu or dialog finish returning focus first.
  useEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => {
      const el =
        focus === 'add' ? addRef.current : document.querySelector<HTMLElement>(`[data-section-menu="${focus.id}"]`);
      el?.focus();
      setFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, test.sections]);

  if (questions.isError) return <InlineMessage>{t('common.loadFailed')}</InlineMessage>;
  if (!questions.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  const approved = questions.data.items.filter((q) => q.status === 'approved');
  const poolOf = (id: string) => approved.filter((q) => q.sectionId === id);

  const move = (s: Section, by: -1 | 1) =>
    save.mutate(moved(sections, s.id, by), {
      onSuccess: () => {
        notify.success(t('sections.moved'));
        setFocus({ id: s.id });
      },
    });
  const remove = (s: Section) => {
    const i = sections.findIndex((x) => x.id === s.id);
    const rest = sections.filter((x) => x.id !== s.id);
    save.mutate(rest, {
      onSuccess: () => {
        setDeleting(null);
        notify.success(t('sections.deleted'));
        const next = rest[i] ?? rest[i - 1];
        setFocus(next ? { id: next.id } : 'add');
      },
    });
  };

  const add = (
    <Button ref={addRef} disabled={readOnly} onClick={() => setEditing({})}>
      {t('sections.add')}
    </Button>
  );
  return (
    <div className="flex flex-col gap-6">
      {save.isError && !editing ? (
        <InlineMessage>{t('common.saveFailed', { reason: save.error.message })}</InlineMessage>
      ) : null}
      {sections.length === 0 ? (
        <>
          <EmptyState message={t('sections.empty')} action={add} />
          <WholeTestDraw key={test.updatedAt} test={test} approved={approved.length} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-graphite">{t('sections.lead')}</p>
            {add}
          </div>
          <Table
            caption={t('sections.table')}
            rows={sections}
            rowKey={(s) => s.id}
            columns={[
              { key: 'order', header: t('sections.col.order'), align: 'end', cell: (s) => formatCount(s.order) },
              { key: 'name', header: t('sections.col.name'), cell: (s) => s.name },
              {
                key: 'questions',
                header: t('sections.col.questions'),
                align: 'end',
                cell: (s) => formatCount(poolOf(s.id).length),
              },
              { key: 'draw', header: t('sections.col.draw'), cell: drawText },
              { key: 'mix', header: t('sections.col.mix'), cell: mixText },
              { key: 'duration', header: t('sections.col.duration'), cell: durationText },
              {
                key: 'navigation',
                header: t('sections.col.navigation'),
                cell: (s) => t(s.forwardOnly ? 'sections.forwardOnly' : 'sections.free'),
              },
              {
                key: 'actions',
                header: <span className="sr-only">{t('common.actions')}</span>,
                align: 'end',
                cell: (s) => {
                  const i = sections.indexOf(s);
                  return (
                    <Menu
                      trigger={
                        <Button
                          variant="ghost"
                          aria-label={t('common.actionsFor', { name: s.name })}
                          data-section-menu={s.id}
                          className="min-w-11 px-2"
                          disabled={readOnly}
                        >
                          <MoreHorizontal aria-hidden size={20} />
                        </Button>
                      }
                      items={[
                        { label: t('sections.edit'), onSelect: () => setEditing({ section: s }) },
                        { label: t('sections.moveUp'), disabled: i === 0, onSelect: () => move(s, -1) },
                        {
                          label: t('sections.moveDown'),
                          disabled: i === sections.length - 1,
                          onSelect: () => move(s, 1),
                        },
                        { label: t('sections.delete'), destructive: true, onSelect: () => setDeleting(s) },
                      ]}
                    />
                  );
                },
              },
            ]}
          />
        </>
      )}
      {editing ? (
        <SectionDialog
          test={test}
          section={editing.section}
          pool={editing.section ? poolOf(editing.section.id) : []}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={t('sections.deleteTitle', { name: deleting.name })}
          description={t('sections.deleteBody')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('sections.deleteConfirm')}
          destructive
          confirmDisabled={save.isPending}
          onConfirm={() => remove(deleting)}
        >
          {save.isError ? <InlineMessage>{save.error.message}</InlineMessage> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
