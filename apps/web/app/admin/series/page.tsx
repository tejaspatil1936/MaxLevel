import type { Metadata } from 'next';
import { SeriesList } from '@/features/authoring/series/SeriesList';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.series') };

export default function SeriesListPage() {
  return <SeriesList />;
}
