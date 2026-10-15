import { notFound } from 'next/navigation';
import { findByEditToken } from '@aio/core/forms';
import { db } from '@/lib/server';
import { loadPublicForm } from '@/lib/forms';
import { FormRenderer } from '@/components/form-renderer';
import { PublicShell } from '@/app/public-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit your response', referrer: 'no-referrer' as const };

export default async function EditResponsePage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const form = await loadPublicForm(slug);
  if (!form || !form.allowEdit) notFound();
  const sub = await findByEditToken(db(), form.id, token);
  return (
    <PublicShell title={`Edit: ${form.title}`} description={form.description} accent={form.accentColor}>
      {!sub ? (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-4">
          This edit link is not valid. It may already have been used, since each save gives you a new link.
        </p>
      ) : !form.isOpen ? (
        <p role="status" className="rounded-lg border border-line bg-panel-2 p-4 whitespace-pre-wrap">
          {form.closedMessage}
        </p>
      ) : (
        <FormRenderer
          editToken={token}
          initial={Object.fromEntries(sub.answers.map((a) => [a.questionId, (typeof a.value === 'number' ? String(a.value) : a.value) as string | string[] | boolean]))}
          form={{ slug: form.slug, title: form.title, description: form.description, accentColor: form.accentColor, questions: form.questions.map((q) => ({ id: q.id, type: q.type, label: q.label, description: q.description, required: q.required, options: q.options })) }}
        />
      )}
    </PublicShell>
  );
}
