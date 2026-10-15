'use client';

import { useState } from 'react';
import { api } from '@/lib/client';

export function DevLoginButton() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-6 border-t border-line pt-4">
      <p className="mb-2 text-xs text-muted">Development preview (DASHBOARD_DEV_LOGIN). Never enabled in production.</p>
      <button
        type="button"
        disabled={busy}
        className="h-11 w-full rounded-lg border border-line-strong text-sm font-medium transition-colors hover:bg-panel-2 disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          await api('/api/auth/dev-login', { method: 'POST' }).catch(() => undefined);
          window.location.href = '/dashboard';
        }}
      >
        Continue as dev preview
      </button>
    </div>
  );
}
