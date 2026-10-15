'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Alert, Button, Card, PageHeader, PageSkeleton } from '@/components/ui';
import { ChannelPicker, MultiRolePicker } from '@/components/pickers';
import { useResources, useToast } from '@/components/providers';

interface StaffRoles {
  staffRoleIds: string[];
  musicStaffRoleIds: string[];
  ticketStaffRoleIds: string[];
  auditLogChannelId: string | null;
}

export default function SettingsPage() {
  const [v, setV] = useState<StaffRoles | null>(null);
  const [saving, setSaving] = useState(false);
  const { notify, fail } = useToast();
  const { error, reload } = useResources();
  useEffect(() => {
    api<StaffRoles>('/api/staff-roles').then(setV).catch(fail);
  }, [fail]);
  if (!v) return <PageSkeleton />;
  const save = async () => {
    setSaving(true);
    try {
      setV(await api<StaffRoles>('/api/staff-roles', { method: 'PUT', body: v }));
      notify('Saved.');
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Staff & settings" description="Who counts as staff for bot features. Dashboard access always requires Discord Administrator permission." actions={<Button variant="primary" onClick={save} loading={saving}>Save</Button>} />
      {error && (
        <Alert tone="warn" title="Discord data unavailable">
          {error} You can still paste IDs manually; they are validated when Discord is reachable. <button className="underline" onClick={reload}>Retry</button>
        </Alert>
      )}
      <Card title="Staff roles" description="Staff can moderate, handle tickets and bypass music limits. Administrators are always staff.">
        <div className="grid gap-5 md:grid-cols-3">
          <MultiRolePicker label="General staff" hint="Moderation, verification reset, all staff features." value={v.staffRoleIds} onChange={(staffRoleIds) => setV({ ...v, staffRoleIds })} />
          <MultiRolePicker label="Music staff" hint="Can control any music room and bypass the five-in-a-row limit." value={v.musicStaffRoleIds} onChange={(musicStaffRoleIds) => setV({ ...v, musicStaffRoleIds })} />
          <MultiRolePicker label="Ticket staff" hint="Default responders for ticket types without their own roles." value={v.ticketStaffRoleIds} onChange={(ticketStaffRoleIds) => setV({ ...v, ticketStaffRoleIds })} />
        </div>
      </Card>
      <Card title="Bot audit channel" description="Optional channel where the bot posts dashboard changes. The full audit log is always kept in the dashboard.">
        <div className="max-w-md">
          <ChannelPicker label="Audit channel" value={v.auditLogChannelId} onChange={(id) => setV({ ...v, auditLogChannelId: id ?? null })} />
        </div>
      </Card>
    </div>
  );
}
