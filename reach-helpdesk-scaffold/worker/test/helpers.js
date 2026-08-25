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

// In-memory stand-in for the D1 binding, shaped around the queries src/db.js runs.
export class FakeDB {
  constructor() {
    this.conversations = new Map();
    this.messages = [];
    this.escalations = [];
    this.online = false;
    this.nextId = 0;
  }
  prepare(sql) {
    const db = this;
    const exec = (args) => {
      if (sql.includes('INSERT INTO conversations')) {
        if (!db.conversations.has(args[0])) {
          db.conversations.set(args[0], {
            id: args[0], site: args[1], church: args[2], user_name: args[3], user_email: args[4],
            status: 'open', handled_by: 'leo', agent_last_read_id: 0, created_at: 't0', updated_at: 't0',
          });
        }
        return [];
      }
      if (sql.includes('INSERT INTO messages')) {
        const msg = { id: ++db.nextId, conversation_id: args[0], role: args[1], content: args[2], created_at: 't1' };
        db.messages.push(msg);
        return [msg];
      }
      if (sql.includes('INSERT INTO escalations')) {
        db.escalations.push({ conversation_id: args[0], reason: args[1], ghl_status: args[2], created_at: 't2' });
        return [];
      }
      if (sql.includes('SET status')) {
        const c = db.conversations.get(args[0]);
        if (c) c.status = args[1];
        return [];
      }
      if (sql.includes('SET handled_by')) {
        const c = db.conversations.get(args[0]);
        if (c) c.handled_by = args[1];
        return [];
      }
      if (sql.includes('SET agent_last_read_id')) {
        const c = db.conversations.get(args[0]);
        if (c) {
          const ids = db.messages.filter((m) => m.conversation_id === args[0]).map((m) => m.id);
          c.agent_last_read_id = ids.length ? Math.max(...ids) : 0;
        }
        return [];
      }
      if (sql.includes('UPDATE presence')) {
        db.online = !sql.includes('NULL');
        return [];
      }
      if (sql.includes('FROM presence')) {
        return db.online ? [{ online: 1 }] : [];
      }
      if (sql.includes('LEFT JOIN')) {
        return [...db.conversations.values()].map((c) => {
          const msgs = db.messages.filter((m) => m.conversation_id === c.id);
          const last = msgs[msgs.length - 1];
          return {
            ...c,
            msg_count: msgs.length,
            last_id: last ? last.id : 0,
            last_at: last ? last.created_at : c.created_at,
            last_snippet: last ? last.content : '',
          };
        });
      }
      if (sql.includes('SELECT * FROM conversations WHERE id')) {
        const c = db.conversations.get(args[0]);
        return c ? [{ ...c }] : [];
      }
      if (sql.includes('FROM escalations')) {
        return db.escalations.filter((e) => e.conversation_id === args[0]);
      }
      if (sql.includes('AND id >')) {
        return db.messages.filter((m) => m.conversation_id === args[0] && m.id > args[1]);
      }
      // history: newest-first (DESC LIMIT n); caller reverses
      if (sql.includes('DESC')) {
        const rows = db.messages
          .filter((m) => m.conversation_id === args[0])
          .map((m) => ({ role: m.role, content: m.content }));
        return rows.slice(-args[1]).reverse();
      }
      throw new Error('FakeDB: unhandled SQL: ' + sql.slice(0, 80));
    };
    const stmt = (args) => ({
      async run() { exec(args); return { success: true }; },
      async all() { return { results: exec(args) }; },
    });
    // Mirror D1: statements are usable with or without .bind()
    return { bind: (...args) => stmt(args), ...stmt([]) };
  }
}

export function testEnv(overrides = {}) {
  return {
    DB: new FakeDB(),
    WIDGET_SIGNING_SECRET: 'test-secret',
    GHL_WEBHOOK_URL: 'https://ghl.example/hooks/abc',
    ADMIN_KEY: 'test-admin',
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

export function adminPost(path, body) {
  return new Request(`https://helpdesk.test${path}?key=test-admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function pollRequest(env, conversationId, afterId = 0) {
  const ctx = testContext(env.WIDGET_SIGNING_SECRET);
  const q = new URLSearchParams({
    conversation_id: conversationId,
    after_id: String(afterId),
    site: ctx.site,
    user_email: ctx.user_email,
    ts: String(ctx.ts),
    sig: ctx.sig,
  });
  return new Request(`https://helpdesk.test/messages?${q}`);
}
