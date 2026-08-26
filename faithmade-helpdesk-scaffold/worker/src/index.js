import { verifyContext } from './auth.js';
import { relevantDocs, kbBlock } from './kb.js';
import { askLeo } from './claude.js';
import { escalateToGhl } from './ghl.js';
import { handleAdmin } from './admin.js';
import * as db from './db.js';

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

async function handleChat(env, request, body) {
  const { context, conversation_id: conversationId, message } = body;
  if (!conversationId || typeof message !== 'string' || !message.trim()) {
    return json(request, 400, { error: 'conversation_id and message are required' });
  }

  await db.ensureConversation(env, conversationId, context);
  const userMsg = await db.storeMessage(env, conversationId, 'user', message.slice(0, MESSAGE_MAX_CHARS));

  const conv = await db.getConversation(env, conversationId);
  const online = await db.isTeamOnline(env);

  // Once a human owns the thread, Leo stands down — the message just lands in
  // the inbox and the client hears back via live chat (or email if offline).
  if (conv && conv.handled_by === 'team') {
    if (conv.status === 'resolved') await db.setStatus(env, conversationId, 'open');
    return json(request, 200, {
      reply: null,
      handled_by: 'team',
      team_online: online,
      last_id: userMsg.id,
      escalate_suggested: false,
    });
  }

  const history = await db.loadHistory(env, conversationId);
  const kb = kbBlock(relevantDocs(message));
  const { reply, escalate } = await askLeo(env, context, history, kb);

  const leoMsg = await db.storeMessage(env, conversationId, 'assistant', reply);
  return json(request, 200, {
    reply,
    handled_by: 'leo',
    team_online: online,
    last_id: leoMsg.id,
    escalate_suggested: escalate,
  });
}

// Client poll: new messages after last_id, presence, and thread state.
async function handleMessages(env, request, url) {
  const context = {
    site: url.searchParams.get('site'),
    user_email: url.searchParams.get('user_email'),
    ts: url.searchParams.get('ts'),
    sig: url.searchParams.get('sig'),
  };
  const auth = await verifyContext(env, context);
  if (!auth.ok) return json(request, 401, { error: auth.error });

  const conversationId = url.searchParams.get('conversation_id') || '';
  const afterId = Number(url.searchParams.get('after_id') || 0);
  const conv = await db.getConversation(env, conversationId);
  const messages = conv ? await db.messagesAfter(env, conversationId, afterId) : [];
  return json(request, 200, {
    messages: messages.filter((m) => m.role !== 'user'),
    team_online: await db.isTeamOnline(env),
    status: conv ? conv.status : 'open',
    handled_by: conv ? conv.handled_by : 'leo',
  });
}

async function handleEscalate(env, request, body) {
  const { context, conversation_id: conversationId, reason } = body;
  if (!conversationId) {
    return json(request, 400, { error: 'conversation_id is required' });
  }
  const userMessage = String(body.user_message || '').slice(0, 1000).trim();
  const phone = String(body.phone || '').slice(0, 30).trim();

  await db.ensureConversation(env, conversationId, context);
  if (userMessage) {
    await db.storeMessage(env, conversationId, 'user', userMessage);
  }
  const history = await db.loadHistory(env, conversationId);
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'USER' : m.role === 'agent' ? 'TEAM' : 'LEO'}: ${m.content}`)
    .join('\n');

  const status = await escalateToGhl(env, {
    context,
    conversationId,
    reason: reason || 'User requested a human',
    userMessage,
    phone,
    transcript: transcript || '(no prior messages)',
  });

  const dbReason = (reason || 'User requested a human') + (userMessage ? ` — client note: ${userMessage}` : '');
  await db.recordEscalation(env, conversationId, dbReason, status);
  await db.setStatus(env, conversationId, 'escalated');

  const ok = status >= 200 && status < 300;
  return json(request, ok ? 200 : 502, { ok, ghl_status: status, team_online: await db.isTeamOnline(env) });
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
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return handleAdmin(env, request, url);
    }

    try {
      if (request.method === 'GET' && url.pathname === '/messages') {
        return await handleMessages(env, request, url);
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

      return url.pathname === '/chat'
        ? await handleChat(env, request, body)
        : await handleEscalate(env, request, body);
    } catch (err) {
      console.error('helpdesk error', err);
      return json(request, 500, { error: 'internal error' });
    }
  },
};
