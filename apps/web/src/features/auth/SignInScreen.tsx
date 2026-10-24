'use client';

import { Button, InlineMessage, cx } from '@mitaoe/ui';
import {
  Activity,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Lock,
  Mic,
  MonitorX,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Video,
  WifiOff,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AccessibilityButton } from '@/features/shell/AccessibilityPanel';
import { MaxLevelLogo } from '@/features/shell/MaxLevelLogo';
import { t, type MessageKey } from '@/i18n';
import { homeFor } from '@/lib/homes';
import { useSession } from '@/lib/session';

const REFUSALS: Record<string, MessageKey> = {
  NOT_ON_LIST: 'signIn.notOnList',
  ORG_SUSPENDED: 'signIn.suspended',
  ORG_ARCHIVED: 'signIn.archived',
};

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" className="shrink-0">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export function SignInScreen() {
  const { session, signInWithGoogle, chooseOrg, signOut } = useSession();
  const router = useRouter();
  const [audienceTab, setAudienceTab] = useState<'students' | 'orgs'>('students');

  useEffect(() => {
    if (session.status === 'ready') router.replace(homeFor(session.me.role));
  }, [session, router]);

  const busy = session.status === 'loading' || session.status === 'signingIn';
  const message =
    session.status === 'notOnList'
      ? t(REFUSALS[session.code] ?? 'signIn.unavailable')
      : session.status === 'failed'
        ? t('signIn.failed')
        : null;

  if (session.status === 'chooseOrg') {
    return (
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex min-h-screen max-w-student flex-col justify-center px-4 py-12"
      >
        <div className="rounded-panel border border-rule bg-surface p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <MaxLevelLogo size={36} />
            <span className="text-caption font-bold uppercase tracking-wider text-graphite">{t('app.name')}</span>
          </div>
          <h1 className="mt-4 font-display text-display-2 font-bold tracking-tight text-ink">
            {t('signIn.chooseOrg')}
          </h1>
          <p className="mt-2 max-w-measure text-body text-graphite">{t('signIn.chooseOrgLead')}</p>
          <div role="group" aria-label={t('signIn.yourOrgs')} className="mt-8 flex max-w-measure flex-col gap-3">
            {session.orgs.map((o) => (
              <Button
                key={o.orgId}
                variant="secondary"
                size="lg"
                className="w-full justify-start text-body font-bold"
                onClick={() => void chooseOrg(o.orgId)}
              >
                <span className="mr-2 h-2.5 w-2.5 rounded-full bg-ballpoint" aria-hidden="true" />
                <span>{o.name}</span>
              </Button>
            ))}
          </div>
          <div className="mt-8 border-t border-rule pt-6">
            <Button variant="ghost" onClick={() => void signOut()}>
              {t('app.signOut')}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-sheet text-ink">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-rule bg-surface">
        <div className="mx-auto flex min-h-16 max-w-student items-center justify-between gap-4 px-4 py-2">
          <div className="flex items-center gap-3">
            <MaxLevelLogo size={36} />
            <div className="flex flex-col">
              <span className="font-display text-heading-2 font-extrabold tracking-tight text-ink leading-none">
                {t('app.name')}
              </span>
              <span className="mt-1 text-[11px] font-semibold text-graphite uppercase tracking-wider leading-none">
                {t('landing.tagline')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-rule bg-surface-sunken px-3 py-1 text-caption font-semibold text-graphite sm:flex">
              <span className="h-2 w-2 rounded-full bg-tick animate-pulse" aria-hidden="true" />
              <span>{t('landing.networkReady')}</span>
            </div>
            <AccessibilityButton />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {/* Hero Section */}
        <section aria-labelledby="hero-heading" className="border-b border-rule bg-surface py-12 md:py-16">
          <div className="mx-auto max-w-student px-4">
            <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
              {/* Left Column: Platform Mission & Architectural Proof */}
              <div className="flex flex-col gap-6 lg:col-span-7">
                <div className="inline-flex items-center gap-2 self-start rounded-full border border-rule bg-ballpoint-wash px-3 py-1 text-caption font-bold text-ballpoint">
                  <ShieldCheck size={15} aria-hidden="true" />
                  <span>{t('landing.heroBadge')}</span>
                </div>

                <h2
                  id="hero-heading"
                  className="font-display text-heading-1 sm:text-[2.75rem] font-bold tracking-tight text-ink leading-tight"
                >
                  <span>{t('landing.heroTitle1')}</span>{' '}
                  <span className="block text-ballpoint">{t('landing.heroTitle2')}</span>
                </h2>

                <p className="max-w-measure text-body text-graphite leading-relaxed">{t('landing.heroLead')}</p>

                {/* Key Technical Guarantees Grid */}
                <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-2">
                  <div className="rounded-control border border-rule bg-sheet p-3.5">
                    <div className="font-display text-heading-2 font-bold text-ink">{t('landing.stat1Val')}</div>
                    <div className="mt-0.5 text-caption font-bold text-graphite">{t('landing.stat1Label')}</div>
                    <div className="mt-1 text-[12px] text-graphite/90 leading-snug">{t('landing.stat1Desc')}</div>
                  </div>

                  <div className="rounded-control border border-rule bg-sheet p-3.5">
                    <div className="font-display text-heading-2 font-bold text-ink">{t('landing.stat2Val')}</div>
                    <div className="mt-0.5 text-caption font-bold text-graphite">{t('landing.stat2Label')}</div>
                    <div className="mt-1 text-[12px] text-graphite/90 leading-snug">{t('landing.stat2Desc')}</div>
                  </div>

                  <div className="rounded-control border border-rule bg-sheet p-3.5">
                    <div className="font-display text-heading-2 font-bold text-ink">{t('landing.stat3Val')}</div>
                    <div className="mt-0.5 text-caption font-bold text-graphite">{t('landing.stat3Label')}</div>
                    <div className="mt-1 text-[12px] text-graphite/90 leading-snug">{t('landing.stat3Desc')}</div>
                  </div>

                  <div className="rounded-control border border-rule bg-sheet p-3.5">
                    <div className="font-display text-heading-2 font-bold text-ink">{t('landing.stat4Val')}</div>
                    <div className="mt-0.5 text-caption font-bold text-graphite">{t('landing.stat4Label')}</div>
                    <div className="mt-1 text-[12px] text-graphite/90 leading-snug">{t('landing.stat4Desc')}</div>
                  </div>
                </div>
              </div>

              {/* Right Column: Accessible Authentication Portal */}
              <div className="lg:col-span-5">
                <div className="rounded-panel border-2 border-rule bg-sheet p-6 shadow-sm sm:p-8">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-surface px-2.5 py-0.5 text-caption font-bold uppercase tracking-wider text-graphite">
                      <Lock size={12} aria-hidden="true" />
                      <span>{t('landing.portalTag')}</span>
                    </span>
                    <span className="text-[11px] font-bold text-tick uppercase">{t('landing.ssoBadge')}</span>
                  </div>

                  {/* Accessible Level-1 Heading required by tests */}
                  <h1 className="mt-4 font-display text-display-2 font-bold tracking-tight text-ink">
                    {t('signIn.title')}
                  </h1>
                  <p className="mt-2 text-body text-graphite">{t('signIn.lead')}</p>

                  <div className="mt-6 flex flex-col gap-3">
                    {/* Primary Google Auth Button */}
                    <Button
                      size="lg"
                      className="w-full justify-center gap-3 font-bold text-body shadow-sm"
                      onClick={() => void signInWithGoogle()}
                      disabled={busy}
                      aria-describedby={busy ? 'sign-in-progress' : undefined}
                    >
                      <GoogleIcon />
                      <span>{t('signIn.google')}</span>
                    </Button>

                    <p id="sign-in-progress" role="status" className="min-h-6 text-center text-caption text-graphite">
                      {session.status === 'signingIn' ? t('signIn.signingIn') : null}
                    </p>
                  </div>

                  <div className="mt-2 max-w-measure">
                    <InlineMessage>{message}</InlineMessage>
                  </div>

                  <div className="mt-6 border-t border-rule pt-4 text-[12px] text-graphite leading-relaxed">
                    <p>{t('landing.ssoNotice')}</p>
                  </div>

                  <Link
                    href="/accessibility/"
                    className="mt-4 inline-flex min-h-11 items-center text-body-small font-bold text-ballpoint underline"
                  >
                    {t('statement.link')}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Next-Gen Proctoring Innovations Section */}
        <section
          aria-labelledby="innovations-heading"
          className="border-b border-rule bg-surface-sunken py-16 md:py-20"
        >
          <div className="mx-auto max-w-student px-4">
            <div className="max-w-measure">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-ballpoint-wash px-3 py-1 text-caption font-bold text-ballpoint">
                <Sparkles size={14} aria-hidden="true" />
                <span>{t('landing.innovations.tag')}</span>
              </span>
              <h3
                id="innovations-heading"
                className="mt-4 font-display text-heading-1 font-bold tracking-tight text-ink"
              >
                {t('landing.innovations.heading')}
              </h3>
              <p className="mt-3 text-body text-graphite leading-relaxed">{t('landing.innovations.lead')}</p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {/* Innovation 1: AI Background Audio & Whisper Detector */}
              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm transition-shadow hover:shadow-md">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <Mic size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-3 font-bold text-ink">{t('landing.innovations.audioTitle')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">
                    {t('landing.innovations.audioDesc')}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.innovations.audioBadge')}</span>
                </div>
              </div>

              {/* Innovation 2: Dual Monitor & HDMI Splitter Defense */}
              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm transition-shadow hover:shadow-md">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <MonitorX size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-3 font-bold text-ink">{t('landing.innovations.displayTitle')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">
                    {t('landing.innovations.displayDesc')}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.innovations.displayBadge')}</span>
                </div>
              </div>

              {/* Innovation 3: Script & Auto-Typer Protection */}
              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm transition-shadow hover:shadow-md">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <ShieldAlert size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-3 font-bold text-ink">{t('landing.innovations.inputTitle')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">
                    {t('landing.innovations.inputDesc')}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.innovations.inputBadge')}</span>
                </div>
              </div>

              {/* Innovation 4: Virtual Camera & Video Loop Shield */}
              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm transition-shadow hover:shadow-md">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <Video size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-3 font-bold text-ink">{t('landing.innovations.cameraTitle')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">
                    {t('landing.innovations.cameraDesc')}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.innovations.cameraBadge')}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Audience Feature Showcase Section */}
        <section aria-labelledby="audience-heading" className="py-16 md:py-20">
          <div className="mx-auto max-w-student px-4">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-measure">
                <span className="text-caption font-bold uppercase tracking-widest text-ballpoint">
                  {t('landing.audience.tag')}
                </span>
                <h3 id="audience-heading" className="mt-2 font-display text-heading-1 font-bold text-ink">
                  {t('landing.audience.heading')}
                </h3>
                <p className="mt-3 text-body text-graphite">{t('landing.audience.lead')}</p>
              </div>

              {/* Segmented Audience Tab Controls */}
              <div
                role="tablist"
                aria-label={t('landing.audience.tabAriaLabel')}
                className="inline-flex self-start rounded-panel border border-rule bg-surface p-1 shadow-sm"
              >
                <button
                  type="button"
                  role="tab"
                  id="tab-students"
                  aria-selected={audienceTab === 'students'}
                  aria-controls="panel-students"
                  className={cx(
                    'flex items-center gap-2 rounded-control px-4 py-2 text-body-small font-bold whitespace-nowrap transition-colors',
                    audienceTab === 'students'
                      ? 'bg-ballpoint text-on-ballpoint border border-ballpoint'
                      : 'border border-transparent text-graphite hover:text-ink hover:bg-surface-sunken',
                  )}
                  onClick={() => setAudienceTab('students')}
                >
                  <GraduationCap
                    size={18}
                    aria-hidden="true"
                    className={audienceTab === 'students' ? 'text-on-ballpoint' : 'text-graphite'}
                  />
                  <span>{t('landing.audience.tabStudents')}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  id="tab-orgs"
                  aria-selected={audienceTab === 'orgs'}
                  aria-controls="panel-orgs"
                  className={cx(
                    'flex items-center gap-2 rounded-control px-4 py-2 text-body-small font-bold whitespace-nowrap transition-colors',
                    audienceTab === 'orgs'
                      ? 'bg-ballpoint text-on-ballpoint border border-ballpoint'
                      : 'border border-transparent text-graphite hover:text-ink hover:bg-surface-sunken',
                  )}
                  onClick={() => setAudienceTab('orgs')}
                >
                  <Building2
                    size={18}
                    aria-hidden="true"
                    className={audienceTab === 'orgs' ? 'text-on-ballpoint' : 'text-graphite'}
                  />
                  <span>{t('landing.audience.tabOrgs')}</span>
                </button>
              </div>
            </div>

            {/* Students Panel */}
            <div
              id="panel-students"
              role="tabpanel"
              aria-labelledby="tab-students"
              hidden={audienceTab !== 'students'}
              className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2"
            >
              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <Lock size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-2 font-bold text-ink">{t('landing.students.card1Title')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">
                    {t('landing.students.card1Desc')}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.students.card1Badge')}</span>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <WifiOff size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-2 font-bold text-ink">{t('landing.students.card2Title')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">
                    {t('landing.students.card2Desc')}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.students.card2Badge')}</span>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <Smartphone size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-2 font-bold text-ink">{t('landing.students.card3Title')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">
                    {t('landing.students.card3Desc')}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.students.card3Badge')}</span>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <Sparkles size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-2 font-bold text-ink">{t('landing.students.card4Title')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">
                    {t('landing.students.card4Desc')}
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.students.card4Badge')}</span>
                </div>
              </div>
            </div>

            {/* Organizations Panel */}
            <div
              id="panel-orgs"
              role="tabpanel"
              aria-labelledby="tab-orgs"
              hidden={audienceTab !== 'orgs'}
              className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2"
            >
              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <Activity size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-2 font-bold text-ink">{t('landing.orgs.card1Title')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">{t('landing.orgs.card1Desc')}</p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.orgs.card1Badge')}</span>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <FileSpreadsheet size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-2 font-bold text-ink">{t('landing.orgs.card2Title')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">{t('landing.orgs.card2Desc')}</p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.orgs.card2Badge')}</span>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <Bot size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-2 font-bold text-ink">{t('landing.orgs.card3Title')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">{t('landing.orgs.card3Desc')}</p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.orgs.card3Badge')}</span>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-6 shadow-sm">
                <div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-ballpoint-wash text-ballpoint">
                    <FileText size={24} aria-hidden="true" />
                  </div>
                  <h4 className="mt-4 text-heading-2 font-bold text-ink">{t('landing.orgs.card4Title')}</h4>
                  <p className="mt-2 text-body-small text-graphite leading-relaxed">{t('landing.orgs.card4Desc')}</p>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-rule pt-4 text-caption font-bold text-tick">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{t('landing.orgs.card4Badge')}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Architectural Comparison Section */}
        <section aria-labelledby="compare-heading" className="border-t border-rule bg-surface-sunken py-16 md:py-20">
          <div className="mx-auto max-w-student px-4">
            <div className="max-w-measure">
              <span className="text-caption font-bold uppercase tracking-widest text-ballpoint">
                {t('landing.compare.tag')}
              </span>
              <h3 id="compare-heading" className="mt-2 font-display text-heading-1 font-bold text-ink">
                {t('landing.compare.heading')}
              </h3>
            </div>

            <div className="mt-10 overflow-hidden rounded-panel border border-rule bg-surface shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-body-small">
                  <thead>
                    <tr className="border-b border-rule bg-surface-sunken">
                      <th
                        scope="col"
                        className="p-4 text-caption font-bold uppercase tracking-wider text-graphite sm:w-1/4"
                      >
                        {t('landing.compare.colFeature')}
                      </th>
                      <th
                        scope="col"
                        className="p-4 text-caption font-bold uppercase tracking-wider text-graphite sm:w-3/8"
                      >
                        {t('landing.compare.colLegacy')}
                      </th>
                      <th
                        scope="col"
                        className="border-l border-rule bg-ballpoint-wash p-4 text-caption font-bold uppercase tracking-wider text-ballpoint sm:w-3/8"
                      >
                        {t('landing.compare.colMaxLevel')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    <tr>
                      <th scope="row" className="p-4 font-bold text-ink align-top">
                        {t('landing.compare.row1Feature')}
                      </th>
                      <td className="p-4 text-graphite align-top">
                        <div className="flex items-start gap-2">
                          <X size={16} className="mt-0.5 shrink-0 text-redpen" aria-hidden="true" />
                          <span>{t('landing.compare.row1Legacy')}</span>
                        </div>
                      </td>
                      <td className="border-l border-rule bg-surface p-4 font-semibold text-ink align-top">
                        <div className="flex items-start gap-2">
                          <Check size={16} className="mt-0.5 shrink-0 text-tick" aria-hidden="true" />
                          <span>{t('landing.compare.row1MaxLevel')}</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="p-4 font-bold text-ink align-top">
                        {t('landing.compare.row2Feature')}
                      </th>
                      <td className="p-4 text-graphite align-top">
                        <div className="flex items-start gap-2">
                          <X size={16} className="mt-0.5 shrink-0 text-redpen" aria-hidden="true" />
                          <span>{t('landing.compare.row2Legacy')}</span>
                        </div>
                      </td>
                      <td className="border-l border-rule bg-surface p-4 font-semibold text-ink align-top">
                        <div className="flex items-start gap-2">
                          <Check size={16} className="mt-0.5 shrink-0 text-tick" aria-hidden="true" />
                          <span>{t('landing.compare.row2MaxLevel')}</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="p-4 font-bold text-ink align-top">
                        {t('landing.compare.row3Feature')}
                      </th>
                      <td className="p-4 text-graphite align-top">
                        <div className="flex items-start gap-2">
                          <X size={16} className="mt-0.5 shrink-0 text-redpen" aria-hidden="true" />
                          <span>{t('landing.compare.row3Legacy')}</span>
                        </div>
                      </td>
                      <td className="border-l border-rule bg-surface p-4 font-semibold text-ink align-top">
                        <div className="flex items-start gap-2">
                          <Check size={16} className="mt-0.5 shrink-0 text-tick" aria-hidden="true" />
                          <span>{t('landing.compare.row3MaxLevel')}</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="p-4 font-bold text-ink align-top">
                        {t('landing.compare.row4Feature')}
                      </th>
                      <td className="p-4 text-graphite align-top">
                        <div className="flex items-start gap-2">
                          <X size={16} className="mt-0.5 shrink-0 text-redpen" aria-hidden="true" />
                          <span>{t('landing.compare.row4Legacy')}</span>
                        </div>
                      </td>
                      <td className="border-l border-rule bg-surface p-4 font-semibold text-ink align-top">
                        <div className="flex items-start gap-2">
                          <Check size={16} className="mt-0.5 shrink-0 text-tick" aria-hidden="true" />
                          <span>{t('landing.compare.row4MaxLevel')}</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="p-4 font-bold text-ink align-top">
                        {t('landing.compare.row5Feature')}
                      </th>
                      <td className="p-4 text-graphite align-top">
                        <div className="flex items-start gap-2">
                          <X size={16} className="mt-0.5 shrink-0 text-redpen" aria-hidden="true" />
                          <span>{t('landing.compare.row5Legacy')}</span>
                        </div>
                      </td>
                      <td className="border-l border-rule bg-surface p-4 font-semibold text-ink align-top">
                        <div className="flex items-start gap-2">
                          <Check size={16} className="mt-0.5 shrink-0 text-tick" aria-hidden="true" />
                          <span>{t('landing.compare.row5MaxLevel')}</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* Operational Workflow Section */}
        <section aria-labelledby="workflow-heading" className="border-t border-rule bg-surface py-16">
          <div className="mx-auto max-w-student px-4">
            <div className="max-w-measure">
              <span className="text-caption font-bold uppercase tracking-widest text-ballpoint">
                {t('landing.workflowTag')}
              </span>
              <h3 id="workflow-heading" className="mt-2 font-display text-heading-1 font-bold text-ink">
                {t('landing.workflowHeading')}
              </h3>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
              <div className="flex flex-col border-t-2 border-ballpoint pt-4">
                <span className="font-display text-heading-1 font-bold text-ballpoint">{t('landing.step1Num')}</span>
                <h4 className="mt-2 text-heading-3 font-bold text-ink">{t('landing.step1Title')}</h4>
                <p className="mt-2 text-body-small text-graphite leading-relaxed">{t('landing.step1Desc')}</p>
              </div>

              <div className="flex flex-col border-t-2 border-ballpoint pt-4">
                <span className="font-display text-heading-1 font-bold text-ballpoint">{t('landing.step2Num')}</span>
                <h4 className="mt-2 text-heading-3 font-bold text-ink">{t('landing.step2Title')}</h4>
                <p className="mt-2 text-body-small text-graphite leading-relaxed">{t('landing.step2Desc')}</p>
              </div>

              <div className="flex flex-col border-t-2 border-ballpoint pt-4">
                <span className="font-display text-heading-1 font-bold text-ballpoint">{t('landing.step3Num')}</span>
                <h4 className="mt-2 text-heading-3 font-bold text-ink">{t('landing.step3Title')}</h4>
                <p className="mt-2 text-body-small text-graphite leading-relaxed">{t('landing.step3Desc')}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Technical Specifications Matrix */}
        <section aria-labelledby="specs-heading" className="border-t border-rule bg-sheet py-16">
          <div className="mx-auto max-w-student px-4">
            <h3 id="specs-heading" className="font-display text-heading-1 font-bold text-ink">
              {t('landing.specsHeading')}
            </h3>
            <p className="mt-2 max-w-measure text-body text-graphite">{t('landing.specsLead')}</p>

            <div className="mt-8 overflow-hidden rounded-panel border border-rule bg-surface shadow-sm">
              <div className="divide-y divide-rule text-body-small">
                <div className="grid grid-cols-1 gap-2 bg-surface-sunken p-4 text-caption font-bold text-graphite uppercase tracking-wider sm:grid-cols-3">
                  <div>{t('landing.specCol1')}</div>
                  <div className="sm:col-span-2">{t('landing.specCol2')}</div>
                </div>

                <div className="grid grid-cols-1 items-center gap-2 p-4 sm:grid-cols-3">
                  <div className="font-bold text-ink">{t('landing.spec1Title')}</div>
                  <div className="text-graphite sm:col-span-2">{t('landing.spec1Desc')}</div>
                </div>

                <div className="grid grid-cols-1 items-center gap-2 p-4 sm:grid-cols-3">
                  <div className="font-bold text-ink">{t('landing.spec2Title')}</div>
                  <div className="text-graphite sm:col-span-2">{t('landing.spec2Desc')}</div>
                </div>

                <div className="grid grid-cols-1 items-center gap-2 p-4 sm:grid-cols-3">
                  <div className="font-bold text-ink">{t('landing.spec3Title')}</div>
                  <div className="text-graphite sm:col-span-2">{t('landing.spec3Desc')}</div>
                </div>

                <div className="grid grid-cols-1 items-center gap-2 p-4 sm:grid-cols-3">
                  <div className="font-bold text-ink">{t('landing.spec4Title')}</div>
                  <div className="text-graphite sm:col-span-2">{t('landing.spec4Desc')}</div>
                </div>

                <div className="grid grid-cols-1 items-center gap-2 p-4 sm:grid-cols-3">
                  <div className="font-bold text-ink">{t('landing.spec5Title')}</div>
                  <div className="text-graphite sm:col-span-2">{t('landing.spec5Desc')}</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Institutional Footer */}
      <footer className="border-t border-rule bg-surface py-12">
        <div className="mx-auto flex max-w-student flex-col items-start justify-between gap-6 px-4 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <MaxLevelLogo size={24} />
              <span className="font-display text-heading-3 font-bold text-ink">{t('app.name')}</span>
            </div>
            <p className="text-caption text-graphite">{t('landing.footerDesc')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-caption text-graphite">
            <Link href="/accessibility/" className="font-bold text-ballpoint hover:underline">
              {t('statement.link')}
            </Link>
            <span>{t('landing.copyright')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
