import { createHmac } from 'node:crypto';

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

// Minimal in-memory stand-in for the D1 binding, shaped around the queries
// src/index.js actually runs.
export class FakeDB {
  constructor() {
    this.conversations = new Map();
    this.messages = [];
    this.escalations = [];
  }
  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async run() {
            if (sql.includes('INSERT INTO conversations')) db.conversations.set(args[0], args);
            else if (sql.includes('INSERT INTO messages'))
              db.messages.push({ conversation_id: args[0], role: args[1], content: args[2] });
            else if (sql.includes('INSERT INTO escalations'))
              db.escalations.push({ conversation_id: args[0], reason: args[1], ghl_status: args[2] });
            return { success: true };
          },
          async all() {
            // history query: newest-first (DESC LIMIT n); caller reverses
            const rows = db.messages
              .filter((m) => m.conversation_id === args[0])
              .map((m) => ({ role: m.role, content: m.content }));
            return { results: rows.slice(-args[1]).reverse() };
          },
        };
      },
    };
  }
}

export function testEnv(overrides = {}) {
  return {
    DB: new FakeDB(),
    WIDGET_SIGNING_SECRET: 'test-secret',
    GHL_WEBHOOK_URL: 'https://ghl.example/hooks/abc',
    MOCK_CLAUDE: '1',
    CLAUDE_MODEL: 'claude-opus-5',
    ...overrides,
  };
}

export function postJson(path, body) {
  return new Request(`https://helpdesk.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://gracechurch.org' },
    body: JSON.stringify(body),
  });
}
