'use client';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-bad/40 bg-bad/5 p-6">
      <h2 className="font-semibold">Something went wrong on this page.</h2>
      <p className="mt-1 text-sm text-muted">{error.digest ? `Reference: ${error.digest}` : 'Please try again.'}</p>
      <button type="button" onClick={reset} className="mt-4 rounded-lg border border-line px-4 py-2 text-sm">
        Try again
      </button>
    </div>
  );
}
