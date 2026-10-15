'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/client';
import { Alert, Button, Card, TextArea } from '@/components/ui';
import { DiscordMarkdown } from '@/components/discord-preview';
import { useToast } from '@/components/providers';

type Result =
  | { ok: true; text: string; citations: { ref: string; jumpUrl: string; channelName: string; authorName: string; date: string }[]; model: string; budgetWarning: boolean; label: string; advisory: string }
  | { ok: false; message: string; reason: string };

export function TestTab() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const { fail } = useToast();
  return (
    <Card title="Ask a test question" description="Answered by the running bot with your own channel access, exactly like in Discord, but nothing is posted. Counts toward usage and budget.">
      <TextArea label="Question" value={question} onChange={setQuestion} maxLength={2000} rows={3} />
      <div className="mt-3">
        <Button
          variant="primary"
          loading={busy}
          disabled={!question.trim()}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            try {
              setResult(await api<Result>('/api/ai/test', { body: { question } }));
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Ask
        </Button>
      </div>
      {result && (
        <div className="mt-5">
          {result.ok ? (
            <div className="space-y-3">
              {result.budgetWarning && <Alert tone="warn">Budget warning threshold reached.</Alert>}
              <div className="rounded-xl bg-discord-bg p-4 text-[15px] text-[#dbdee1]">
                <p className="mb-1 text-xs font-medium text-[#949ba4]">{result.label}</p>
                <DiscordMarkdown text={result.text} />
                <p className="mt-2 text-xs text-[#949ba4]">{result.advisory}</p>
              </div>
              {result.citations.length > 0 && (
                <ul className="space-y-1 text-xs text-muted">
                  {result.citations.map((c) => (
                    <li key={c.ref}>
                      [{c.ref}] #{c.channelName} · {c.authorName} · {c.date}{' '}
                      <a href={c.jumpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent">
                        open <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted">Model: {result.model}</p>
            </div>
          ) : (
            <Alert tone="warn" title="No answer">
              {result.message}
            </Alert>
          )}
        </div>
      )}
    </Card>
  );
}
