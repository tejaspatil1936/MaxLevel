// Phase 8 public accessibility statement copy (docs/testids/phase-8.md "Public accessibility statement").
// The Timed exams text repeats docs/runbooks/exam-day.md "## Timing and accessibility" (A11Y-18).
export const statement = {
  'statement.title': 'Accessibility statement',
  'statement.link': 'Accessibility statement',
  'statement.lead':
    'MITAOE Prep is used by students, placement cells and administrators. We want everyone to be able to use it, including people who use assistive technology.',
  'statement.standard': 'Standard',
  'statement.standardText': 'Our target is WCAG 2.2 level AA on every screen, including the exam.',
  'statement.standardSettings':
    'You can change the text size, theme, contrast, motion and spacing, and turn on a reading ruler, from Accessibility settings in the top bar. Your choices follow your account.',
  'statement.gaps': 'Known gaps',
  'statement.gapsLead': 'These parts do not meet the standard yet:',
  'statement.gapAssistive':
    'Screen readers and screen magnifiers that take window focus can count as leaving the exam window, which records a strike. There is no assistive-technology accommodation that stops this yet.',
  'statement.gapCamera':
    'Proctored exams need a camera. There is no way yet to exempt a student from the camera requirement.',
  'statement.gapShortcuts':
    "The exam's single-key shortcuts cannot be turned off or changed yet (WCAG 2.2, success criterion 2.1.4 Character key shortcuts).",
  'statement.gapsHelp': 'If one of these affects you, contact us before your exam.',
  'statement.timed': 'Timed exams',
  'statement.timedText':
    "Timed exams fall under WCAG's exception for real-time events (WCAG 2.2, success criterion 2.2.1 Timing adjustable). The time limit is an essential part of a timed, proctored test, so you cannot turn off or extend the timer yourself.",
  'statement.timedLead': 'Adjustable time is still provided in two ways:',
  'statement.timedExtra': 'Extra time: an admin can give you extra time during an attempt.',
  'statement.timedAccommodation':
    'Standing accommodations: your placement cell can record an accommodation for a series, as a percentage of the duration or a number of extra minutes. It is added to every attempt of that series.',
  'statement.contact': 'Contact',
  'statement.contactExam': 'For extra time or an accommodation in an exam, ask your placement cell before the exam.',
  'statement.contactEmail': 'To report an accessibility problem or ask for help with MITAOE Prep, email us:',
  'statement.home': 'Go to MITAOE Prep',
} as const;
