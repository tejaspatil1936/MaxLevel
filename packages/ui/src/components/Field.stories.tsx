import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Checkbox, Switch } from './Choice';
import { SelectField, TextField } from './Field';

const meta: Meta = { title: 'Controls/Fields' };
export default meta;

export const States: StoryObj = {
  render: function Render() {
    const [on, setOn] = useState(true);
    const [ticked, setTicked] = useState(false);
    return (
      <div className="grid max-w-measure gap-4">
        <TextField label="Full name" requiredText="(required)" defaultValue="Aarav Kulkarni" />
        <TextField label="PRN" hint="As printed on your college ID card" />
        <TextField
          label="Slug"
          error="This slug is taken. Choose another, for example mitaoe-2."
          defaultValue="mitaoe"
        />
        <SelectField
          label="Department"
          placeholder="Choose a department"
          options={[
            { value: 'c', label: 'Computer' },
            { value: 'i', label: 'IT' },
          ]}
        />
        <Checkbox label="I agree to the exam rules" checked={ticked} onCheckedChange={setTicked} />
        <Switch label="Lock profile editing" checked={on} onCheckedChange={setOn} stateText={on ? 'On' : 'Off'} />
        <Switch label="Disabled switch" checked={false} onCheckedChange={() => {}} disabled stateText="Off" />
      </div>
    );
  },
};
