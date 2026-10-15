import { randomBytes } from 'node:crypto';
import pino, { type Logger } from 'pino';

/**
 * Structured logging with defense-in-depth secret redaction.
 * Known sensitive keys are removed by path, and string values are scrubbed for
 * token-shaped content in case a secret ends up inside an error message.
 */

const SENSITIVE_KEYS = [
  'token',
  'TOKEN',
  'password',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'Authorization',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'cookie',
  'answer',
  'captchaAnswer',
  'editToken',
  'encryptedKey',
  'privateNotes',
];

const REDACT_PATHS = SENSITIVE_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `headers.${k}`, `req.headers.${k}`]);

const TOKEN_PATTERNS: RegExp[] = [
  // Discord bot tokens
  /[MNO][\w-]{23,}\.[\w-]{6}\.[\w-]{27,}/g,
  /\b[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}\b/g,
  // Google API keys
  /AIza[0-9A-Za-z_-]{35}/g,
  // OpenAI / Anthropic / OpenRouter style keys
  /\bsk-(?:ant-|or-)?[A-Za-z0-9_-]{16,}\b/g,
  // Bearer tokens in strings
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // Postgres URLs with passwords
  /(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi,
];

export function redactString(input: string): string {
  let out = input;
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}[REDACTED]@` : '[REDACTED]',
    );
  }
  return out;
}

export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as T;
  if (value && typeof value === 'object') {
    if (value instanceof Error) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.some((s) => s.toLowerCase() === k.toLowerCase()) ? '[REDACTED]' : redactDeep(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

export function serializeError(err: unknown): { name: string; message: string; stack?: string; code?: unknown } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redactString(err.message),
      stack: err.stack ? redactString(err.stack) : undefined,
      code: (err as { code?: unknown }).code,
    };
  }
  return { name: 'NonError', message: redactString(String(err)) };
}

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: { err: serializeError, error: serializeError },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === 'string' ? redactString(a) : a));
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
  });
}

/** Short, user-shareable error reference (e.g. ERR-7F3A9C) so staff can find the log line. */
export function newErrorId(): string {
  return `ERR-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export type { Logger };
