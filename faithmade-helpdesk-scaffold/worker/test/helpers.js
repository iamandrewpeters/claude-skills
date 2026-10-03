import { createHmac } from 'node:crypto';
import { createD1 } from './d1.js';
import worker from '../src/index.js';

// Tests never touch the network: any fetch not routed through withFetch() fails.
globalThis.fetch = async (url) => {
  throw new Error(`unexpected network call in a test: ${url}`);
};

export const TEAM = 'andrew@faithmade.test';
export const BASE = 'https://helpdesk.test';

// Independent HMAC implementation (node:crypto) — cross-checks the Worker's
// WebCrypto one in src/auth.js.
export function signContext(secret, context) {
  const sig = createHmac('sha256', secret)
    .update(`${context.site}|${context.user_email}|${context.ts}`)
    .digest('hex');
  return { ...context, sig };
}

export function testContext(secret, overrides = {}) {
  return signContext(secret, {
    site: 'https://gracechurch.org',
    church: 'Grace Church',
    user_name: 'Jane Smith',
    user_email: 'jane@gracechurch.org',
    ts: Math.floor(Date.now() / 1000),
    ...overrides,
  });
}

export function testEnv(overrides = {}) {
  return {
    DB: createD1(),
    WIDGET_SIGNING_SECRET: 'test-secret',
    TOKEN_SECRET: 'test-token-secret',
    GHL_WEBHOOK_URL: 'https://ghl.example/hooks/abc',
    ADMIN_KEY: 'test-admin',
    MOCK_CLAUDE: '1',
    CLAUDE_MODEL: 'claude-opus-5',
    PUBLIC_URL: BASE,
    REPLY_DOMAIN: 'reply.faithmade.app',
    TEAM_EMAILS: TEAM,
    ...overrides,
  };
}

export const run = (env, request) => worker.fetch(request, env, { waitUntil() {} });

export function postJson(path, body) {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://gracechurch.org' },
    body: JSON.stringify(body),
  });
}

export function widget(env, path, body = {}, contextOverrides = {}) {
  return run(env, postJson(path, { context: testContext(env.WIDGET_SIGNING_SECRET, contextOverrides), conversation_id: 'conv-test-1', ...body }));
}

export async function chat(env, message, extra = {}) {
  const res = await widget(env, '/chat', { message, ...extra });
  return res.json();
}

export function adminPost(path, body) {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' },
    body: JSON.stringify(body),
  });
}

export function adminGet(path) {
  return new Request(`${BASE}${path}`, { headers: { 'x-admin-key': 'test-admin' } });
}

export function pollRequest(env, conversationId, afterId = 0, extra = {}) {
  return postJson('/messages', {
    context: testContext(env.WIDGET_SIGNING_SECRET),
    conversation_id: conversationId,
    after_id: afterId,
    ...extra,
  });
}

// Captures outbound fetches (GHL webhook, Resend) for the duration of fn.
export async function withFetch(handler, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      headers: new Headers(init && init.headers),
      body: init && init.body ? JSON.parse(init.body) : null,
    });
    return handler(String(url), init);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
  return calls;
}

export const okFetch = () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });

// A raw RFC 822 message, as Email Routing hands it to the Worker.
export function rawEmail({ from, to, subject = 'Re: Leo needs you', text, headers = {} }) {
  const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('');
  return (
    `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@mail.test>\r\n` +
    `Date: Sat, 03 Oct 2026 09:14:00 -0500\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n${extra}\r\n${text}`
  );
}

// Minimal ForwardableEmailMessage.
export function emailMessage({ from, to, subject, text, headers = {} }) {
  const raw = rawEmail({ from, to, subject, text, headers });
  const message = {
    from,
    to,
    raw: new Response(raw).body,
    rawSize: raw.length,
    headers: new Headers(headers),
    rejected: null,
    setReject(reason) {
      message.rejected = reason;
    },
  };
  return message;
}

// Runs the email() handler to completion.
export async function deliverEmail(env, msg) {
  await worker.email(msg, env, { waitUntil() {} });
  return msg;
}

export const outbound = (env, kind) =>
  env.DB.rows("SELECT * FROM email_log WHERE direction = 'out'" + (kind ? ' AND kind = ?' : '') + ' ORDER BY id', ...(kind ? [kind] : []));
