// English messages (A11Y-23). The test editor's Sections and Marking and timers tabs (docs/testids/phase-2.md).
export const sections = {
  'sections.drawAll': 'All',
  'sections.mixNone': 'None',
  'sections.mixText': '{easy} easy, {medium} medium, {hard} hard',
  'sections.testTimer': 'Test timer',
  'sections.nameMissing': 'Enter the section name.',
  'sections.drawInvalid': 'Enter a whole number of questions, 1 or more.',
  'sections.mixInvalid': 'Enter a whole number, 0 or more.',
  'sections.drawTooLarge.one': "This section has 1 approved question, so it can't draw {n}.",
  'sections.drawTooLarge.other': "This section has {m} approved questions, so it can't draw {n}.",
  'sections.mixTooLarge.one': "This section has 1 {difficulty} question, so the mix can't take {n}.",
  'sections.mixTooLarge.other': "This section has {m} {difficulty} questions, so the mix can't take {n}.",
  'sections.mixMismatch': 'The mix adds up to {t} questions. Set Questions to draw to {t} or leave it empty.',
  'sections.testDrawTooLarge.one': "This test has 1 approved question, so it can't draw {n}.",
  'sections.testDrawTooLarge.other': "This test has {m} approved questions, so it can't draw {n}.",
} as const;
