import { verifyContext } from './auth.js';
import { relevantDocs, kbBlock } from './kb.js';
import { askClaude } from './claude.js';
import { escalateToGhl } from './ghl.js';

const HISTORY_LIMIT = 20;
const MESSAGE_MAX_CHARS = 4000;

function corsHeaders(request) {
  // Tenant wp-admin origins are many and changing; auth is the HMAC context
  // signature (auth.js), not an origin allowlist.
  return {
    'access-control-allow-origin': request.headers.get('origin') || '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

function json(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(request) },
  });
}

async function ensureConversation(env, id, context) {
  await env.DB.prepare(
    `INSERT INTO conversations (id, site, church, user_name, user_email)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')`
  )
    .bind(id, context.site, context.church || null, context.user_name || null, context.user_email)
    .run();
}

async function storeMessage(env, conversationId, role, content) {
  await env.DB.prepare(
    'INSERT INTO messages (conversation_id, role, content) VALUES (?1, ?2, ?3)'
  )
    .bind(conversationId, role, content)
    .run();
}

async function loadHistory(env, conversationId) {
  const { results } = await env.DB.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY id DESC LIMIT ?2'
  )
    .bind(conversationId, HISTORY_LIMIT)
    .all();
  return results.reverse();
}

async function handleChat(env, request, body) {
  const { context, conversation_id: conversationId, message } = body;
  if (!conversationId || typeof message !== 'string' || !message.trim()) {
    return json(request, 400, { error: 'conversation_id and message are required' });
  }

  await ensureConversation(env, conversationId, context);
  await storeMessage(env, conversationId, 'user', message.slice(0, MESSAGE_MAX_CHARS));

  const history = await loadHistory(env, conversationId);
  const kb = kbBlock(relevantDocs(message));
  const { reply, escalate } = await askClaude(env, context, history, kb);

  await storeMessage(env, conversationId, 'assistant', reply);
  return json(request, 200, { reply, escalate_suggested: escalate });
}

async function handleEscalate(env, request, body) {
  const { context, conversation_id: conversationId, reason } = body;
  if (!conversationId) {
    return json(request, 400, { error: 'conversation_id is required' });
  }

  await ensureConversation(env, conversationId, context);
  const history = await loadHistory(env, conversationId);
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'USER' : 'BOT'}: ${m.content}`)
    .join('\n');

  const status = await escalateToGhl(env, {
    context,
    conversationId,
    reason: reason || 'User requested a human',
    transcript: transcript || '(no prior messages)',
  });

  await env.DB.prepare(
    'INSERT INTO escalations (conversation_id, reason, ghl_status) VALUES (?1, ?2, ?3)'
  )
    .bind(conversationId, reason || 'User requested a human', status)
    .run();
  await env.DB.prepare(
    "UPDATE conversations SET status = 'escalated', updated_at = datetime('now') WHERE id = ?1"
  )
    .bind(conversationId)
    .run();

  const ok = status >= 200 && status < 300;
  return json(request, ok ? 200 : 502, { ok, ghl_status: status });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (url.pathname === '/health') {
      return json(request, 200, { ok: true });
    }
    if (request.method !== 'POST' || !['/chat', '/escalate'].includes(url.pathname)) {
      return json(request, 404, { error: 'not found' });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(request, 400, { error: 'invalid JSON' });
    }

    const auth = await verifyContext(env, body.context);
    if (!auth.ok) {
      return json(request, 401, { error: auth.error });
    }

    try {
      return url.pathname === '/chat'
        ? await handleChat(env, request, body)
        : await handleEscalate(env, request, body);
    } catch (err) {
      console.error('helpdesk error', err);
      return json(request, 500, { error: 'internal error' });
    }
  },
};
