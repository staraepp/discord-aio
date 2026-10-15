export function PublicShell({ title, description, accent = '#5865f2', children }: { title: string; description?: string; accent?: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[radial-gradient(60rem_30rem_at_50%_-10rem,rgb(88_101_242/0.08),transparent)] px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-pop)]">
        <div className="h-1.5" style={{ background: accent }} />
        <div className="space-y-6 p-5 sm:p-8">
          <header>
            <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-[28px]">{title}</h1>
            {description && <p className="mt-2 leading-relaxed whitespace-pre-wrap text-muted">{description}</p>}
          </header>
          {children}
        </div>
      </div>
    </main>
  );
}
