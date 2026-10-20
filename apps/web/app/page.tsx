import type { Metadata } from 'next';
import { SignInScreen } from '@/features/auth/SignInScreen';
import { t } from '@/i18n';

// The root layout's title template does not apply to a page in the same segment, so name it in full.
export const metadata: Metadata = { title: { absolute: `${t('signIn.title')} – ${t('app.name')}` } };

export default function SignInPage() {
  return <SignInScreen />;
}
