import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from './Button';
import { ConfirmDialog, Dialog, Drawer } from './Dialog';
import { Menu } from './Menu';
import { Tabs } from './Tabs';
import { notify, Toaster } from './Toast';

const meta: Meta = { title: 'Overlays/Dialogs, drawer, menu, tabs, toast' };
export default meta;

export const Overlays: StoryObj = {
  render: function Render() {
    const [dialog, setDialog] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [drawer, setDrawer] = useState(false);
    const [tab, setTab] = useState('questions');
    return (
      <div className="grid gap-6">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Open dialog
          </Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Delete student
          </Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>
            Open drawer
          </Button>
          <Menu
            label="More actions"
            trigger={<Button variant="secondary">More</Button>}
            items={[
              { label: 'Export', onSelect: () => {} },
              { label: 'Remove', onSelect: () => {}, destructive: true },
            ]}
          />
          <Button variant="secondary" onClick={() => notify.success('Test published')}>
            Show toast
          </Button>
        </div>
        <Tabs
          value={tab}
          onValueChange={setTab}
          label="Test editor"
          tabs={[
            { value: 'questions', label: 'Questions', content: <p>Questions tab</p> },
            { value: 'settings', label: 'Settings', content: <p>Settings tab</p> },
          ]}
        />
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Rename department"
          description="Students see the new name at once."
          footer={<Button onClick={() => setDialog(false)}>Save</Button>}
        >
          <p>Dialog body</p>
        </Dialog>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          destructive
          title="Delete Aarav Kulkarni?"
          description="Their results are kept."
          cancelLabel="Cancel"
          confirmLabel="Delete student"
          onConfirm={() => setConfirm(false)}
        />
        <Drawer open={drawer} onOpenChange={setDrawer} title="Aarav Kulkarni" description="student01@a.test">
          <p>Profile, attempts and history.</p>
        </Drawer>
        <Toaster />
      </div>
    );
  },
};
