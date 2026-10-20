import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';

const meta: Meta<typeof Button> = { title: 'Controls/Button', component: Button };
export default meta;

export const Variants: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button>Publish test</Button>
      <Button variant="secondary">Discard</Button>
      <Button variant="ghost">Use series value</Button>
      <Button variant="danger">Delete student</Button>
      <Button disabled>Publish test</Button>
      <Button size="lg">Save and next</Button>
    </div>
  ),
};
