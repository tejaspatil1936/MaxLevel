import type { Metadata } from 'next';
import { NewSeries } from '@/features/authoring/series/SeriesForm';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('series.new') };

export default function NewSeriesPage() {
  return <NewSeries />;
}
