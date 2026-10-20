'use client';

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { problemText, type Question, type Section } from '@mitaoe/shared';
import { Button, cx, StatusPill } from '@mitaoe/ui';
import { GripVertical } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '@/i18n';
import { QuestionText } from '../../exam/QuestionView';

interface ItemProps {
  question: Question;
  n: number;
  section?: Section;
  lifted: boolean;
  helpId: string;
  disabled: boolean;
  registerHandle: (el: HTMLButtonElement | null) => void;
  onHandleKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onHandleBlur: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}

/** One question: its number, prompt as students see it, section, status and, for a draft, its reasons (Q17). */
function QuestionItem(p: ItemProps) {
  const { question: q, n } = p;
  const { setNodeRef, setActivatorNodeRef, listeners, transform, isDragging } = useSortable({
    id: q.id,
    disabled: p.disabled,
    transition: null,
  });
  const forN = t('questions.forQuestion', { n });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cx(
        'flex gap-2 border-b border-rule bg-surface py-3 pr-3 last:border-b-0',
        (isDragging || p.lifted) && 'relative z-10 bg-ballpoint-wash shadow-overlay',
      )}
    >
      <button
        type="button"
        ref={(el) => {
          setActivatorNodeRef(el);
          p.registerHandle(el);
        }}
        {...listeners}
        aria-label={t('questions.reorderName', { n })}
        aria-describedby={p.helpId}
        aria-pressed={p.lifted}
        disabled={p.disabled}
        onKeyDown={p.onHandleKey}
        onBlur={p.onHandleBlur}
        className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-graphite hover:bg-ballpoint-wash disabled:cursor-not-allowed"
      >
        <GripVertical aria-hidden size={20} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-bold">{t('questions.number', { n })}</span>
          {p.section ? <span className="text-graphite">{p.section.name}</span> : null}
          <StatusPill tone={q.status === 'approved' ? 'success' : 'neutral'}>
            {t(`questions.status.${q.status}`)}
          </StatusPill>
        </div>
        <QuestionText text={q.prompt} className="max-w-question" />
        {/* Not a nested list: the list's items are the questions only. */}
        {q.problems.map((problem) => (
          <p key={problemText(problem)} className="text-body-small font-bold text-redpen">
            {problemText(problem)}
          </p>
        ))}
      </div>
      {/* A11Y-15: stacked below 640 px so the row fits a 320 px screen. */}
      <div className="flex shrink-0 flex-col items-stretch gap-2 pt-1 sm:flex-row sm:items-start">
        {p.onEdit ? (
          <Button variant="secondary" onClick={p.onEdit} disabled={p.disabled}>
            {t('questions.edit')}
            <span className="sr-only">{forN}</span>
          </Button>
        ) : null}
        <Button variant="danger" onClick={p.onDelete} disabled={p.disabled}>
          {t('questions.delete')}
          <span className="sr-only">{forN}</span>
        </Button>
      </div>
    </li>
  );
}

/**
 * Q-01: the questions in order, reordered by dragging a handle or with the keyboard (Space picks up, arrows move,
 * Space drops, Escape cancels), each move announced in a polite live region.
 */
export function QuestionList({
  questions,
  sections,
  readOnly,
  onReorder,
  onEdit,
  onDelete,
}: {
  questions: Question[];
  sections: Section[];
  readOnly: boolean;
  onReorder: (ids: string[]) => void;
  onEdit?: (q: Question, n: number) => void;
  onDelete: (q: Question, n: number) => void;
}) {
  const helpId = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [lifted, setLifted] = useState<{ id: string; start: string[]; order: string[] } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterMove = useRef<string | null>(null);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const order = lifted?.order ?? questions.map((q) => q.id);
  const shown = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const total = shown.length;

  // A moved item's DOM node is moved too, which can drop focus; it goes back to the handle being moved.
  useLayoutEffect(() => {
    const id = focusAfterMove.current;
    focusAfterMove.current = null;
    if (id) handles.current.get(id)?.focus();
  });

  const commit = (ids: string[]) => {
    if (ids.join() !== questions.map((q) => q.id).join()) onReorder(ids);
  };

  const onHandleKey = (id: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = order.indexOf(id);
    if (!lifted || lifted.id !== id) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      setLifted({ id, start: order, order });
      setAnnouncement(t('questions.pickedUp', { n: at + 1 }));
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const to = Math.min(Math.max(at + (e.key === 'ArrowUp' ? -1 : 1), 0), total - 1);
      if (to === at) return;
      focusAfterMove.current = id;
      setLifted({ ...lifted, order: arrayMove(order, at, to) });
      setAnnouncement(t('questions.moved', { n: to + 1, total }));
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setLifted(null);
      setAnnouncement(t('questions.dropped', { n: at + 1, total }));
      commit(order);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      focusAfterMove.current = id;
      setLifted(null);
      setAnnouncement(t('questions.cancelled', { n: lifted.start.indexOf(id) + 1 }));
    }
  };

  // Leaving the handle while an item is picked up puts it back, unless focus only moved with the item.
  const onHandleBlur = (id: string) => () =>
    requestAnimationFrame(() => {
      if (document.activeElement !== handles.current.get(id)) setLifted((cur) => (cur?.id === id ? null : cur));
    });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setAnnouncement(t('questions.dropped', { n: ids.indexOf(String(active.id)) + 1, total }));
    commit(ids);
  };

  return (
    <>
      <p id={helpId} className="sr-only">
        {t('questions.reorderHelp')}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements: NO_ANNOUNCEMENTS, screenReaderInstructions: { draggable: '' } }}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol aria-label={t('questions.list')} className="rounded-panel border border-rule bg-surface">
            {shown.map((q, i) => (
              <QuestionItem
                key={q.id}
                question={q}
                n={i + 1}
                section={sections.find((s) => s.id === q.sectionId)}
                lifted={lifted?.id === q.id}
                helpId={helpId}
                disabled={readOnly}
                registerHandle={(el) => {
                  if (el) handles.current.set(q.id, el);
                  else handles.current.delete(q.id);
                }}
                onHandleKey={onHandleKey(q.id)}
                onHandleBlur={onHandleBlur(q.id)}
                onEdit={onEdit ? () => onEdit(q, i + 1) : undefined}
                onDelete={() => onDelete(q, i + 1)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

/** Moves are announced in this component's own polite live region instead of dnd-kit's assertive one. */
const NO_ANNOUNCEMENTS = {
  onDragStart: () => undefined,
  onDragMove: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};
