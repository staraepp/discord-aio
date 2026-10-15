import { redirect } from 'next/navigation';
import { MODULES, getEnabledModules } from '@aio/core';
import { db, guildId } from '@/lib/server';
import { getSession } from '@/lib/session';
import { AppProviders } from '@/components/providers';
import { Alert } from '@/components/ui';
import { DashboardShell } from './shell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.isAdmin && !session.isOwner) redirect('/login?error=not_admin');
  const enabled = session.isAdmin ? await getEnabledModules(db(), guildId()) : new Set<string>();
  const modules = MODULES.map((m) => ({ id: m.id, name: m.name, route: m.route, description: m.description, enabled: enabled.has(m.id) }));
  return (
    <AppProviders>
      <DashboardShell modules={session.isAdmin ? modules : []} user={{ name: session.username, avatar: session.avatar, id: session.userId, isOwner: session.isOwner }} adminAccess={session.isAdmin}>
        {(session.devPreview || !session.isAdmin) && (
          <div className="mb-6 space-y-3">
            {session.devPreview && <Alert tone="warn" title="Development preview">This session is not signed in with Discord.</Alert>}
            {!session.isAdmin && <Alert tone="warn" title="Owner diagnostics only">Your account is not an administrator of the configured server.</Alert>}
          </div>
        )}
        {children}
      </DashboardShell>
    </AppProviders>
  );
}
