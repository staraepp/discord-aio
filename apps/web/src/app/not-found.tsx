import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-muted">This page does not exist or is no longer available.</p>
      <Link href="/dashboard" className="text-accent underline">
        Go to the dashboard
      </Link>
    </main>
  );
}
