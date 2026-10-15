/**
 * Provider adapters (BYOK). Google Gemini is the primary default; OpenAI,
 * Anthropic, OpenRouter and OpenAI-compatible endpoints are supported.
 * Keys are passed in per call and never logged or returned to the browser.
 */

export type ProviderId = 'google' | 'openai' | 'anthropic' | 'openrouter' | 'openai_compatible';

export const PROVIDERS: { id: ProviderId; label: string; defaultModel: string; needsBaseUrl: boolean; supportsVision: boolean }[] = [
  { id: 'google', label: 'Google Gemini', defaultModel: 'gemini-3.5-flash-lite', needsBaseUrl: false, supportsVision: true },
  { id: 'openai', label: 'OpenAI', defaultModel: '', needsBaseUrl: false, supportsVision: true },
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-haiku-4-5-20251001', needsBaseUrl: false, supportsVision: true },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: '', needsBaseUrl: false, supportsVision: true },
  { id: 'openai_compatible', label: 'OpenAI-compatible', defaultModel: '', needsBaseUrl: true, supportsVision: false },
];

export function isProviderId(v: string): v is ProviderId {
  return PROVIDERS.some((p) => p.id === v);
}

export interface ImagePart {
  mimeType: string;
  base64: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  images?: ImagePart[];
}

export interface ChatRequest {
  model: string;
  system: string;
  turns: ChatTurn[];
  maxOutputTokens: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export type ProviderErrorKind = 'timeout' | 'rate_limit' | 'server' | 'auth' | 'network' | 'bad_request' | 'safety';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** Failover is allowed for availability problems only — never to bypass safety blocks or budget locks. */
  get retryable(): boolean {
    return this.kind === 'timeout' || this.kind === 'rate_limit' || this.kind === 'server' || this.kind === 'network' || this.kind === 'auth';
  }
}

type FetchLike = typeof fetch;

function classifyStatus(status: number): ProviderErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  return 'bad_request';
}

async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new ProviderError('timeout', 'Provider request timed out');
    throw new ProviderError('network', 'Provider could not be reached');
  }
  if (!res.ok) {
    // Never include response bodies verbatim: some providers echo request data.
    throw new ProviderError(classifyStatus(res.status), `Provider returned HTTP ${res.status}`, res.status);
  }
  return res.json();
}

export interface ProviderAdapter {
  id: ProviderId;
  chat(req: ChatRequest, apiKey: string): Promise<ChatResponse>;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'google' as const;
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async chat(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.turns.map((t) => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.text }, ...(t.images ?? []).map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.base64 } }))],
      })),
      generationConfig: { maxOutputTokens: req.maxOutputTokens, temperature: req.temperature ?? 0.4 },
    };
    const data = (await postJson(
      this.fetchImpl,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      { 'x-goog-api-key': apiKey },
      body,
      req.timeoutMs ?? 30_000,
    )) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (data.promptFeedback?.blockReason) throw new ProviderError('safety', `Blocked by provider safety filter (${data.promptFeedback.blockReason})`);
    const cand = data.candidates?.[0];
    if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') throw new ProviderError('safety', 'Blocked by provider safety filter');
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
    return { text, inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
  }
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  constructor(
    readonly id: 'openai' | 'openrouter' | 'openai_compatible',
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async chat(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const messages = [
      { role: 'system', content: req.system },
      ...req.turns.map((t) => ({
        role: t.role,
        content: t.images?.length
          ? [{ type: 'text', text: t.text }, ...t.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.base64}` } }))]
          : t.text,
      })),
    ];
    const data = (await postJson(
      this.fetchImpl,
      `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      { Authorization: `Bearer ${apiKey}` },
      { model: req.model, messages, max_tokens: req.maxOutputTokens, temperature: req.temperature ?? 0.4 },
      req.timeoutMs ?? 30_000,
    )) as { choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) throw new ProviderError('safety', 'Blocked by provider safety filter');
    return { text: (choice?.message?.content ?? '').trim(), inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
  }
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic' as const;
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async chat(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const data = (await postJson(
      this.fetchImpl,
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: req.model,
        system: req.system,
        max_tokens: req.maxOutputTokens,
        messages: req.turns.map((t) => ({
          role: t.role,
          content: [
            ...(t.images ?? []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.base64 } })),
            { type: 'text', text: t.text },
          ],
        })),
      },
      req.timeoutMs ?? 30_000,
    )) as { content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    if (data.stop_reason === 'refusal') throw new ProviderError('safety', 'The provider declined this request');
    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
    return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
  }
}

export function adapterFor(provider: ProviderId, baseUrl: string | null, fetchImpl: FetchLike = fetch): ProviderAdapter {
  switch (provider) {
    case 'google':
      return new GeminiAdapter(fetchImpl);
    case 'anthropic':
      return new AnthropicAdapter(fetchImpl);
    case 'openai':
      return new OpenAiCompatibleAdapter('openai', 'https://api.openai.com/v1', fetchImpl);
    case 'openrouter':
      return new OpenAiCompatibleAdapter('openrouter', 'https://openrouter.ai/api/v1', fetchImpl);
    case 'openai_compatible':
      if (!baseUrl) throw new ProviderError('bad_request', 'OpenAI-compatible providers need a base URL');
      return new OpenAiCompatibleAdapter('openai_compatible', baseUrl, fetchImpl);
  }
}

/** Only allow https base URLs (or localhost for self-hosted development). */
export function isAllowedBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.username || u.password) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}
