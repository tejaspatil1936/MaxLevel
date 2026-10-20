import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { PageHeader } from './PageHeader';
import { EmptyState, InlineMessage, Skeleton, StatusPill } from './Status';

const meta: Meta = { title: 'Feedback/Status' };
export default meta;

export const Pills: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusPill>Draft</StatusPill>
      <StatusPill tone="info">In progress</StatusPill>
      <StatusPill tone="success">Registered</StatusPill>
      <StatusPill tone="danger">Terminated</StatusPill>
      <StatusPill tone="muted">Disabled</StatusPill>
    </div>
  ),
};

export const Messages: StoryObj = {
  render: () => (
    <div className="grid max-w-measure gap-3">
      <InlineMessage>
        {"This Google account isn't on any organization's list. Ask your placement cell to add it."}
      </InlineMessage>
      <InlineMessage tone="info">Changes apply to the next sign-in.</InlineMessage>
      <InlineMessage tone="success">Whitelist saved.</InlineMessage>
    </div>
  ),
};

export const EmptyAndLoading: StoryObj = {
  render: () => (
    <div className="grid gap-4">
      <PageHeader
        title="Students"
        subtitle="Everyone who can sign in to MIT Academy of Engineering."
        actions={<Button>Add student</Button>}
      />
      <EmptyState
        message="No students yet. Upload your whitelist to let students sign in."
        action={<Button>Upload whitelist</Button>}
      />
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-32 w-full" />
    </div>
  ),
};
