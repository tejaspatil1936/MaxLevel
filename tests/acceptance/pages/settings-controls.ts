import { expect, type Locator, type Page } from '@playwright/test';
import { field } from './ui';

// The settings controls shared by the series form (`Default settings`) and the test editor's Settings tab
// (docs/testids/phase-2.md, "Settings (spec 5.4) and how they are named").

export const SETTING_SWITCHES = [
  'Fullscreen required',
  'Laptop camera required',
  'Second camera (phone)',
  'Shuffle questions',
  'Shuffle options',
  'Show past scores to students',
  'Test leaderboard',
  'Series leaderboard',
] as const;
export type SettingSwitch = (typeof SETTING_SWITCHES)[number];

export type SettingSpin = 'Duration (minutes)' | 'Late entry cutoff (minutes)' | 'Maximum strikes';
export type SettingSelect = 'Developer tools policy' | 'Result release' | 'Result detail';
export type SettingRadioGroup = 'Timing mode' | 'Window end policy';

export const SETTING_OPTIONS = {
  'Timing mode': ['Fixed slot', 'Flexible window'],
  'Window end policy': ['Last start leaves full duration', 'Hard close at window end'],
  'Developer tools policy': ['Block and strike', 'Block only', 'Allow (practice tests)'],
  'Result release': ['Immediately on submit', 'After the window closes', 'Manually', 'Never'],
  'Result detail': ['Score only', 'Score with section breakdown', 'Full review with correct answers and explanations'],
} as const;

/** SER-09: the explanation shown on `Result release` for flexible window + full review + release on submit. */
export const FULL_REVIEW_BLOCKED =
  "In a flexible window, a full review released on submit would show the answers to students who haven't started yet. Release results after the window closes, or choose a lower detail level.";

export const SETTING_ERRORS = {
  strikes: 'Enter a whole number from 1 to 10.',
  minutes: 'Enter a whole number of minutes, 1 or more.',
  dailyWindow: 'The daily end time must be after the start time.',
  window: 'The window must end after it starts.',
} as const;

/** The settings controls inside `scope` (a form group or an inherited-setting group). */
export class SettingsControls {
  constructor(
    readonly page: Page,
    readonly scope: Locator,
  ) {}

  radioGroup(name: SettingRadioGroup): Locator {
    return this.scope.getByRole('radiogroup', { name, exact: true });
  }

  radio(group: SettingRadioGroup, option: string): Locator {
    return this.radioGroup(group).getByRole('radio', { name: option, exact: true });
  }

  spin(name: SettingSpin): Locator {
    return this.scope.getByRole('spinbutton', { name, exact: true });
  }

  select(name: SettingSelect): Locator {
    return field(this.scope, name);
  }

  /** The chosen option of a native select. */
  selected(name: SettingSelect): Locator {
    return this.select(name).locator('option:checked');
  }

  switch(name: SettingSwitch): Locator {
    return this.scope.getByRole('switch', { name, exact: true });
  }

  async choose(group: SettingRadioGroup, option: string): Promise<void> {
    await this.radio(group, option).check();
    await expect(this.radio(group, option)).toBeChecked();
  }

  async setSwitch(name: SettingSwitch, on: boolean): Promise<void> {
    const sw = this.switch(name);
    if ((await sw.isChecked()) !== on) await sw.click();
    if (on) await expect(sw).toBeChecked();
    else await expect(sw).not.toBeChecked();
  }

  async pick(name: SettingSelect, label: string): Promise<void> {
    await this.select(name).selectOption({ label });
  }
}
