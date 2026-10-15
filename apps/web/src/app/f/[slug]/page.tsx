import { notFound } from 'next/navigation';
import { loadPublicForm } from '@/lib/forms';
import { turnstileSiteKey } from '@/lib/captcha';
import { FormRenderer } from '@/components/form-renderer';
import { PublicShell } from '@/app/public-shell';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const form = await loadPublicForm((await params).slug);
  return { title: form?.title ?? 'Form' };
}

export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await loadPublicForm(slug);
  if (!form) notFound();
  return (
    <PublicShell title={form.title} description={form.description} accent={form.accentColor}>
      {form.isOpen ? (
        <FormRenderer
          form={{ slug: form.slug, title: form.title, description: form.description, accentColor: form.accentColor, questions: form.questions.map((q) => ({ id: q.id, type: q.type, label: q.label, description: q.description, required: q.required, options: q.options })) }}
          turnstileSiteKey={turnstileSiteKey()}
          turnstileCdata={`form-${form.id}`}
        />
      ) : (
        <p role="status" className="rounded-lg border border-line bg-panel-2 p-4 whitespace-pre-wrap">
          {form.closedMessage}
        </p>
      )}
    </PublicShell>
  );
}
