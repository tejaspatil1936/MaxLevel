'use client';

import { RadioGroup, SelectField, Switch, TextField } from '@mitaoe/ui';
import { t, type MessageKey } from '@/i18n';
import {
  CHOICES,
  NUMBER_KEYS,
  SETTING_KEYS,
  settingShown,
  type ChoiceKey,
  type NumberKey,
  type SettingErrors,
  type SettingKey,
  type SettingsDraft,
} from './settings-draft';

const RADIO_KEYS: readonly ChoiceKey[] = ['timingMode', 'windowEndPolicy'];
const isNumber = (k: SettingKey): k is NumberKey => (NUMBER_KEYS as readonly string[]).includes(k);
const isChoice = (k: SettingKey): k is ChoiceKey => k in CHOICES;
/** The words for one option of a choice setting, for example `Flexible window`. */
export const optionLabel = <K extends ChoiceKey>(key: K, value: SettingsDraft[K]) =>
  t(`setting.${key}.${value}` as MessageKey);

export interface SettingControlProps {
  setting: SettingKey;
  draft: SettingsDraft;
  onChange: (patch: Partial<SettingsDraft>) => void;
  error?: string | null;
  /** The slot length a fixed-slot duration shows, when the window is known (5.4). */
  slotMinutes?: number | null;
  disabled?: boolean;
}

/**
 * One setting's control, labelled as in the settings table. The series form shows them all; the test Settings tab
 * shows each inside its Inherited or Overridden group.
 */
export function SettingControl({ setting, draft, onChange, error, slotMinutes, disabled }: SettingControlProps) {
  const label = t(`setting.${setting}`);
  if (isNumber(setting)) {
    const fixedDuration = setting === 'durationMin' && draft.timingMode === 'fixed';
    return (
      <TextField
        type="number"
        inputMode="numeric"
        step={1}
        min={1}
        max={setting === 'maxStrikes' ? 10 : 1440}
        label={label}
        hint={fixedDuration ? t('setting.durationFixed') : undefined}
        readOnly={fixedDuration}
        disabled={disabled}
        value={fixedDuration && slotMinutes ? String(slotMinutes) : draft[setting]}
        onChange={(e) => onChange({ [setting]: e.target.value })}
        error={fixedDuration ? null : error}
        className="max-w-40 read-only:bg-surface-sunken"
      />
    );
  }
  if (isChoice(setting)) {
    const options = CHOICES[setting].map((v) => ({ value: v, label: optionLabel(setting, v) }));
    if (RADIO_KEYS.includes(setting))
      return (
        <RadioGroup
          label={label}
          value={draft[setting]}
          options={options}
          disabled={disabled}
          onValueChange={(v) => onChange({ [setting]: v })}
        />
      );
    return (
      <SelectField
        label={label}
        value={draft[setting]}
        options={options}
        disabled={disabled}
        onChange={(e) => onChange({ [setting]: e.target.value })}
        error={error}
        className="max-w-measure"
      />
    );
  }
  return (
    <Switch
      label={label}
      checked={draft[setting]}
      disabled={disabled}
      onCheckedChange={(v) => onChange({ [setting]: v })}
      stateText={t(draft[setting] ? 'a11y.on' : 'a11y.off')}
    />
  );
}

/** Every setting of the series form's `Default settings` group, with the ones that do not apply left out. */
export function SettingsFields(props: Omit<SettingControlProps, 'setting' | 'error'> & { errors: SettingErrors }) {
  const { errors, ...rest } = props;
  return (
    <div className="flex flex-col gap-5">
      {SETTING_KEYS.filter((k) => settingShown(k, props.draft)).map((k) => (
        <SettingControl key={k} setting={k} error={errors[k] ? t(errors[k]) : null} {...rest} />
      ))}
    </div>
  );
}
