'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { Advanced, Alert, Button, Card, Confirm, NumberInput, PageHeader, PageSkeleton, Select, TextArea, TextInput, Toggle } from '@/components/ui';
import { FormRenderer, type PublicQuestion } from '@/components/form-renderer';
import { useToast } from '@/components/providers';

type QType = PublicQuestion['type'];
interface Validation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  pattern?: 'email' | 'url' | 'discord_id' | 'discord_username';
  minSelected?: number;
  maxSelected?: number;
}
interface Question {
  id?: string;
  key: string;
  type: QType;
  label: string;
  description: string | null;
  required: boolean;
  options: string[];
  validation: Validation;
}
interface FormDraft {
  title: string;
  slug: string;
  description: string;
  accentColor: string;
  isOpen: boolean;
  closedMessage: string;
  successMessage: string;
  allowEdit: boolean;
  editConfirmationText: string;
  questions: Question[];
}

const TYPES: { value: QType; label: string }[] = [
  { value: 'short_text', label: 'Short answer' },
  { value: 'long_text', label: 'Paragraph' },
  { value: 'single_choice', label: 'Multiple choice (one)' },
  { value: 'multiple_choice', label: 'Checkboxes (many)' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Single checkbox (agreement)' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'section', label: 'Section heading' },
];

let seq = 0;
const key = () => `q${Date.now().toString(36)}${seq++}`;

const BLANK: FormDraft = {
  title: 'Untitled form',
  slug: '',
  description: '',
  accentColor: '#5865f2',
  isOpen: false,
  closedMessage: 'This form is currently closed.',
  successMessage: 'Thanks! Your response has been recorded.',
  allowEdit: false,
  editConfirmationText: "Save this private link if you want to edit your response later. Don't share it.",
  questions: [{ key: key(), type: 'short_text', label: 'Your Discord username', description: 'Typed usernames are not verified.', required: true, options: [], validation: { pattern: 'discord_username' } }],
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export default function FormEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const [draft, setDraft] = useState<FormDraft | null>(isNew ? BLANK : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [preview, setPreview] = useState(false);
  const { notify, fail } = useToast();

  useEffect(() => {
    if (isNew) return;
    api<Omit<FormDraft, 'questions'> & { questions: (Omit<Question, 'key'> & { id: string })[] }>(`/api/forms/${id}`)
      .then((f) => setDraft({ ...f, questions: f.questions.map((q) => ({ ...q, key: q.id, validation: q.validation ?? {} })) }))
      .catch(fail);
  }, [id, isNew, fail]);

  if (!draft) return <PageSkeleton />;
  const set = (patch: Partial<FormDraft>) => setDraft({ ...draft, ...patch });
  const setQ = (i: number, patch: Partial<Question>) => set({ questions: draft.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const move = (i: number, d: -1 | 1) => {
    const qs = [...draft.questions];
    [qs[i], qs[i + d]] = [qs[i + d]!, qs[i]!];
    set({ questions: qs });
  };

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const body = { ...draft, questions: draft.questions.map(({ key: _k, ...q }) => q) };
      const r = await api<{ id: string }>(isNew ? '/api/forms' : `/api/forms/${id}`, { method: isNew ? 'POST' : 'PUT', body });
      notify('Form saved.');
      if (isNew) router.replace(`/dashboard/forms/${r.id}`);
      else setDraft({ ...draft, questions: (r as unknown as { questions: (Question & { id: string })[] }).questions.map((q) => ({ ...q, key: q.id })) });
    } catch (e) {
      if (e instanceof ApiError) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const publicUrl = typeof window !== 'undefined' && draft.slug ? `${window.location.origin}/f/${draft.slug}` : null;

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title={isNew ? 'New form' : draft.title}
        description={publicUrl && !isNew ? <>Public link: <a className="text-accent underline" href={publicUrl} target="_blank" rel="noopener">{publicUrl}</a></> : 'Save the form to get a public link.'}
        actions={
          <>
            <Button onClick={() => setPreview(!preview)}>{preview ? 'Back to editor' : 'Preview'}</Button>
            {!isNew && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button variant="primary" onClick={save} loading={saving}>
              Save form
            </Button>
          </>
        }
      />
      {Object.keys(errors).length > 0 && (
        <Alert tone="bad" title="Please fix these fields">
          <ul>
            {Object.entries(errors).map(([p, m]) => (
              <li key={p}>
                {p}: {m}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {preview ? (
        <Card>
          <div className="mx-auto max-w-2xl space-y-4">
            <h2 className="text-2xl font-semibold">{draft.title}</h2>
            {draft.description && <p className="whitespace-pre-wrap text-muted">{draft.description}</p>}
            <FormRenderer preview form={{ slug: draft.slug, title: draft.title, description: draft.description, accentColor: draft.accentColor, questions: draft.questions.map((q) => ({ ...q, id: q.key })) }} />
          </div>
        </Card>
      ) : (
        <>
          <Card title="Form details">
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="Title" value={draft.title} onChange={(title) => set({ title, slug: isNew && (!draft.slug || draft.slug === slugify(draft.title)) ? slugify(title) : draft.slug })} maxLength={200} error={errors.title} />
              <TextInput label="URL slug" hint="Lowercase letters, numbers and dashes." value={draft.slug} onChange={(slug) => set({ slug: slug.toLowerCase() })} error={errors.slug} maxLength={64} />
              <div className="md:col-span-2">
                <TextArea label="Description" value={draft.description} onChange={(description) => set({ description })} maxLength={4000} rows={3} />
              </div>
              <Toggle label="Accepting responses" checked={draft.isOpen} onChange={(isOpen) => set({ isOpen })} />
              <Toggle label="Let people edit their response" description="Shows a private one-use edit link after submitting. Only a hash of the link is stored." checked={draft.allowEdit} onChange={(allowEdit) => set({ allowEdit })} />
            </div>
          </Card>
          <Card title="Questions">
            <ol className="space-y-3">
              {draft.questions.map((q, i) => (
                <li key={q.key} className="rounded-xl border border-line p-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_14rem_auto]">
                    <TextInput label={q.type === 'section' ? 'Section title' : `Question ${i + 1}`} value={q.label} onChange={(label) => setQ(i, { label })} maxLength={300} error={errors[`questions.${i}.label`]} />
                    <Select label="Type" value={q.type} onChange={(type) => setQ(i, { type, options: ['single_choice', 'multiple_choice', 'dropdown'].includes(type) && q.options.length === 0 ? ['Option 1'] : q.options })} options={TYPES} />
                    <div className="flex items-end gap-1">
                      <Button variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button variant="ghost" aria-label="Move down" disabled={i === draft.questions.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button variant="ghost" aria-label="Delete question" onClick={() => set({ questions: draft.questions.filter((_, j) => j !== i) })}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <TextInput label="Help text" value={q.description ?? ''} onChange={(d) => setQ(i, { description: d || null })} maxLength={1000} />
                    {q.type !== 'section' && <Toggle label="Required" checked={q.required} onChange={(required) => setQ(i, { required })} />}
                  </div>
                  {['single_choice', 'multiple_choice', 'dropdown'].includes(q.type) && (
                    <div className="mt-3 space-y-2">
                      {errors[`questions.${i}.options`] && <p className="text-xs text-bad">{errors[`questions.${i}.options`]}</p>}
                      {q.options.map((o, k) => (
                        <div key={k} className="flex gap-2">
                          <input aria-label={`Option ${k + 1}`} className="h-9 flex-1 rounded-lg border border-line bg-bg px-3 text-sm" value={o} maxLength={200} onChange={(e) => setQ(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} />
                          <Button variant="ghost" size="sm" aria-label="Remove option" onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== k) })}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <Button size="sm" disabled={q.options.length >= 50} onClick={() => setQ(i, { options: [...q.options, `Option ${q.options.length + 1}`] })}>
                        <Plus className="size-4" /> Add option
                      </Button>
                    </div>
                  )}
                  {(q.type === 'short_text' || q.type === 'long_text' || q.type === 'number' || q.type === 'multiple_choice') && (
                    <div className="mt-3">
                      <Advanced title="Validation">
                        <div className="grid gap-3 md:grid-cols-3">
                          {q.type === 'short_text' && (
                            <Select
                              label="Format"
                              value={q.validation.pattern ?? ''}
                              onChange={(p) => setQ(i, { validation: { ...q.validation, pattern: (p || undefined) as Validation['pattern'] } })}
                              options={[
                                { value: '', label: 'Any text' },
                                { value: 'email', label: 'Email' },
                                { value: 'url', label: 'Link' },
                                { value: 'discord_username', label: 'Discord username' },
                                { value: 'discord_id', label: 'Discord ID' },
                              ]}
                            />
                          )}
                          {(q.type === 'short_text' || q.type === 'long_text') && (
                            <>
                              <NumberInput label="Min length" min={0} value={q.validation.minLength} onChange={(v) => setQ(i, { validation: { ...q.validation, minLength: v ?? undefined } })} />
                              <NumberInput label="Max length" min={1} value={q.validation.maxLength} onChange={(v) => setQ(i, { validation: { ...q.validation, maxLength: v ?? undefined } })} />
                            </>
                          )}
                          {q.type === 'number' && (
                            <>
                              <NumberInput label="Minimum" value={q.validation.min} onChange={(v) => setQ(i, { validation: { ...q.validation, min: v ?? undefined } })} />
                              <NumberInput label="Maximum" value={q.validation.max} onChange={(v) => setQ(i, { validation: { ...q.validation, max: v ?? undefined } })} />
                              <Toggle label="Whole numbers only" checked={Boolean(q.validation.integer)} onChange={(integer) => setQ(i, { validation: { ...q.validation, integer } })} />
                            </>
                          )}
                          {q.type === 'multiple_choice' && (
                            <>
                              <NumberInput label="Choose at least" min={0} value={q.validation.minSelected} onChange={(v) => setQ(i, { validation: { ...q.validation, minSelected: v ?? undefined } })} />
                              <NumberInput label="Choose at most" min={1} value={q.validation.maxSelected} onChange={(v) => setQ(i, { validation: { ...q.validation, maxSelected: v ?? undefined } })} />
                            </>
                          )}
                        </div>
                      </Advanced>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <div className="mt-3">
              <Button disabled={draft.questions.length >= 100} onClick={() => set({ questions: [...draft.questions, { key: key(), type: 'short_text', label: 'New question', description: null, required: false, options: [], validation: {} }] })}>
                <Plus className="size-4" /> Add question
              </Button>
            </div>
            {!isNew && <p className="mt-3 text-xs text-muted">Deleting a question also deletes its answers in existing responses.</p>}
          </Card>
          <Advanced title="Messages and appearance">
            <div className="grid gap-4 md:grid-cols-2">
              <TextArea label="Confirmation message" value={draft.successMessage} onChange={(successMessage) => set({ successMessage })} maxLength={2000} rows={2} />
              <TextArea label="Closed message" value={draft.closedMessage} onChange={(closedMessage) => set({ closedMessage })} maxLength={1000} rows={2} />
              {draft.allowEdit && <TextArea label="Edit-link notice" value={draft.editConfirmationText} onChange={(editConfirmationText) => set({ editConfirmationText })} maxLength={1000} rows={2} />}
              <label className="flex items-center gap-3 text-sm">
                Accent color
                <input type="color" value={draft.accentColor} onChange={(e) => set({ accentColor: e.target.value })} className="h-9 w-14 rounded border border-line bg-bg" />
              </label>
            </div>
          </Advanced>
        </>
      )}
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this form?"
        confirmLabel="Delete form and responses"
        phrase="DELETE"
        onConfirm={async () => {
          try {
            await api(`/api/forms/${id}`, { method: 'DELETE' });
            router.replace('/dashboard/forms');
          } catch (e) {
            fail(e);
          }
        }}
      >
        All responses will be permanently deleted.
      </Confirm>
    </div>
  );
}
