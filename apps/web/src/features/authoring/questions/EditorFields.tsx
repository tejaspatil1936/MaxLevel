'use client';

import { Button, FileField, RadioGroup, TextField } from '@mitaoe/ui';
import { X } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { readLogo } from '@/lib/files';
import { optionLetter } from '../../exam/QuestionView';
import { MAX_OPTIONS, MIN_OPTIONS, nextOptionId, type QuestionDraft } from './question-draft';

type DraftSetter = Dispatch<SetStateAction<QuestionDraft>>;

/** Options A to F (2 to 6) and the `Correct answer` radio group, one radio per option (Q-01). */
export function OptionFields({ draft: d, setDraft: setD }: { draft: QuestionDraft; setDraft: DraftSetter }) {
  const options = d.options;
  const set = <K extends keyof QuestionDraft>(k: K, v: QuestionDraft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  return (
    <>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-bold">{t('questions.options')}</legend>
        {options.map((o, i) => (
          <div key={o.id} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <TextField
                label={t('questions.option', { letter: optionLetter(i) })}
                value={o.text}
                onChange={(e) =>
                  set(
                    'options',
                    options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)),
                  )
                }
              />
            </div>
            {options.length > MIN_OPTIONS ? (
              <Button
                variant="ghost"
                aria-label={t('questions.removeOption', { letter: optionLetter(i) })}
                onClick={() =>
                  setD((cur) => ({
                    ...cur,
                    options: cur.options.filter((x) => x.id !== o.id),
                    correct: cur.correct === o.id ? '' : cur.correct,
                  }))
                }
              >
                <X aria-hidden size={18} />
              </Button>
            ) : null}
          </div>
        ))}
        {options.length < MAX_OPTIONS ? (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => set('options', [...options, { id: nextOptionId(options), text: '' }])}
          >
            {t('questions.addOption')}
          </Button>
        ) : null}
      </fieldset>
      <RadioGroup
        label={t('questions.correct')}
        value={d.correct}
        onValueChange={(v) => set('correct', v)}
        options={options.map((o, i) => ({ value: o.id, label: optionLetter(i) }))}
      />
    </>
  );
}

/**
 * A11Y-10: `Add image` uploads the file at once (checked by signature on the server, SEC-06); each image then has
 * its alt text field, and an image without alt text is flagged by the checks.
 */
export function ImageFields({
  testId,
  draft: d,
  setDraft: setD,
  uploading,
  setUploading,
}: {
  testId: string;
  draft: QuestionDraft;
  setDraft: DraftSetter;
  uploading: boolean;
  setUploading: (v: boolean) => void;
}) {
  const [imageError, setImageError] = useState<string>();
  const set = <K extends keyof QuestionDraft>(k: K, v: QuestionDraft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const addImage = async (file: File | undefined) => {
    if (!file) return;
    setImageError(undefined);
    const upload = await readLogo(file);
    if (!upload) return setImageError(t('questions.imageType'));
    setUploading(true);
    try {
      const saved = await api<{ path: string; url: string }>(
        `/v1/tests/${encodeURIComponent(testId)}/question-images`,
        { method: 'POST', body: upload },
      );
      setD((cur) => ({ ...cur, images: [...cur.images, { path: saved.path, alt: '', src: saved.url }] }));
    } catch (err) {
      setImageError(err instanceof Error ? err.message : t('questions.imageType'));
    } finally {
      setUploading(false);
    }
  };
  return (
    <>
      <FileField
        label={t('questions.addImage')}
        hint={uploading ? t('questions.uploading') : t('questions.addImageHint')}
        accept="image/png,image/jpeg,image/svg+xml"
        error={imageError}
        disabled={uploading}
        onChange={(e) => {
          const input = e.currentTarget;
          void addImage(input.files?.[0]).finally(() => {
            input.value = '';
          });
        }}
      />
      {d.images.map((img, i) => (
        <div key={img.path} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label={t('questions.altText', { n: i + 1 })}
              hint={t('questions.altHint')}
              value={img.alt}
              onChange={(e) =>
                set(
                  'images',
                  d.images.map((x) => (x.path === img.path ? { ...x, alt: e.target.value } : x)),
                )
              }
            />
          </div>
          <Button
            variant="ghost"
            aria-label={t('questions.removeImage', { n: i + 1 })}
            onClick={() =>
              set(
                'images',
                d.images.filter((x) => x.path !== img.path),
              )
            }
          >
            <X aria-hidden size={18} />
          </Button>
        </div>
      ))}
    </>
  );
}
