'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import type { ChallengePrompt } from '@aio/core/verification';
import { api } from '@/lib/client';
import { Turnstile } from '@/components/form-renderer';

interface Result {
  status: 'success' | 'failed' | 'cooldown' | 'invalid';
  message: string;
  prompt?: ChallengePrompt | null;
}

type Mode = 'turnstile' | 'image' | 'math';

export function VerifyForm({ token, mode, prompt: initialPrompt, siteKey, cdata }: { token: string; mode: Mode; prompt: ChallengePrompt | null; siteKey: string | null; cdata: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [answer, setAnswer] = useState('');
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const onToken = useCallback((t: string | undefined) => setCaptcha(t), []);

  if (result && result.status !== 'failed') {
    return (
      <div role="status" className="space-y-3 text-center">
        {result.status === 'success' && <CheckCircle2 className="mx-auto size-12 text-good" aria-hidden />}
        <p className="text-lg">{result.message}</p>
      </div>
    );
  }

  const challenge = async (kind: 'image' | 'math') => {
    setSwitching(true);
    setError(null);
    try {
      const r = await api<{ prompt: ChallengePrompt }>('/api/public/verify/challenge', { body: { token, kind } });
      setPrompt(r.prompt);
      setAnswer('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSwitching(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const builtin = mode !== 'turnstile';
      const r = await api<Result>('/api/public/verify', { body: { token, answer: builtin ? answer : undefined, captcha: builtin ? undefined : captcha, kind: builtin ? prompt?.kind : undefined } });
      setResult(r);
      if (r.status === 'failed') {
        setAnswer('');
        if (r.prompt) setPrompt(r.prompt);
        setCaptcha(undefined);
        setWidgetKey((k) => k + 1);
        inputRef.current?.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const linkBtn = 'inline-flex min-h-10 items-center gap-1.5 text-left text-sm font-medium text-accent hover:underline disabled:opacity-50';

  return (
    <form onSubmit={submit} className="space-y-5">
      {result?.status === 'failed' && (
        <p role="alert" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {result.message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          {error}
        </p>
      )}
      {mode === 'turnstile'
        ? siteKey && <Turnstile key={widgetKey} siteKey={siteKey} cdata={cdata} onToken={onToken} />
        : prompt && (
            <div className="space-y-3">
              {prompt.kind === 'image' ? (
                <>
                  <label htmlFor={id} className="block text-base font-medium">
                    Type the letters and numbers you see
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    {/* The code is intentionally not in the alt text; the text-question option below is the accessible alternative. */}
                    <img src={prompt.image} alt="Picture of a code to type" width={264} height={84} className="h-[84px] w-[264px] max-w-full rounded-lg border border-line select-none" draggable={false} />
                    <button type="button" onClick={() => challenge('image')} disabled={switching} className={linkBtn}>
                      <RefreshCw className={switching ? 'size-4 animate-spin' : 'size-4'} aria-hidden /> New picture
                    </button>
                  </div>
                </>
              ) : (
                <label htmlFor={id} className="block text-base font-medium">
                  {prompt.text}
                </label>
              )}
              <input
                ref={inputRef}
                id={id}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                inputMode={prompt.kind === 'math' ? 'numeric' : 'text'}
                autoCapitalize={prompt.kind === 'image' ? 'characters' : 'off'}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                maxLength={20}
                aria-describedby={`${id}-hint`}
                className="h-12 w-56 rounded-lg border border-line bg-bg px-3 font-mono text-lg tracking-widest transition-colors hover:border-line-strong focus:border-accent"
              />
              <p id={`${id}-hint`} className="text-xs text-muted">
                {prompt.kind === 'image' ? 'Capital or lowercase letters both work.' : 'You can type digits (like 7) or the word (like seven).'}
              </p>
              {prompt.kind === 'image' ? (
                <button type="button" onClick={() => challenge('math')} disabled={switching} className={linkBtn}>
                  Can&apos;t read the picture? Answer a text question instead
                </button>
              ) : (
                mode === 'image' && (
                  <button type="button" onClick={() => challenge('image')} disabled={switching} className={linkBtn}>
                    Use a picture code instead
                  </button>
                )
              )}
            </div>
          )}
      <button
        type="submit"
        disabled={busy || switching || (mode === 'turnstile' ? !captcha : !answer.trim())}
        className="h-11 rounded-lg bg-brand px-6 font-medium text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Verify'}
      </button>
    </form>
  );
}
