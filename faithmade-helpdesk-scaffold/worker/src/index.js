import { verifyContext } from './auth.js';
import { handleAdmin } from './admin.js';
import { handleReplyPage } from './reply-page.js';
import { receiveEmail } from './email/inbound.js';
import { clientMessage, escalate, ideaAdminUrl, MESSAGE_MAX_CHARS } from './service.js';
import { sendEmails, teamEmails } from './email/send.js';
import { ideaNewEmail } from './email/templates.js';
import { CONVERSATION_ID_RE } from './tokens.js';
import * as ideas from './ideas.js';
import * as db from './db.js';

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

// --- Chat --------------------------------------------------------------------

// Loads the caller's conversation (creating it on first use). Returns
// { conv } or { error: Response }.
async function ownConversation(env, request, body, { create, touch = true }) {
  const id = String(body.conversation_id || '');
  if (!CONVERSATION_ID_RE.test(id)) return { error: json(request, 400, { error: 'bad conversation_id' }) };
  let conv = await db.getConversation(env, id);
  if (conv && !db.belongsTo(conv, body.context)) {
    // The widget starts a fresh conversation when it sees this.
    return { error: json(request, 403, { error: 'conversation_mismatch' }) };
  }
  if (!conv && create) {
    await db.ensureConversation(env, id, body.context);
    conv = await db.getConversation(env, id);
  }
  if (conv && touch) await db.touchClient(env, id);
  return { conv };
}

async function handleChat(env, request, body) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return json(request, 400, { error: 'message is required' });
  const { conv, error } = await ownConversation(env, request, body, { create: true });
  if (error) return error;

  const r = await clientMessage(env, conv, message.slice(0, MESSAGE_MAX_CHARS), { via: 'widget', context: body.context });
  const fresh = await db.getConversation(env, conv.id);
  return json(request, 200, {
    reply: r.reply,
    handled_by: fresh.handled_by,
    status: fresh.status,
    team_online: await db.isTeamOnline(env),
    user_id: r.userMsg.id,
    last_id: r.leoMsg ? r.leoMsg.id : r.userMsg.id,
    escalate_suggested: !!r.escalate,
    idea_suggested: !!r.idea,
  });
}

// Widget poll (POST so identity stays out of URLs/logs). after_id 0 returns
// the whole visible thread, so a reload — or opening the dashboard from an
// emailed reply — restores the conversation. passive polls come from a closed
// widget (for its unread badge) and don't count as the church watching.
async function handleMessages(env, request, body) {
  const { conv, error } = await ownConversation(env, request, body, { create: false, touch: !body.passive });
  if (error) return error;
  const messages = conv ? await db.visibleMessagesAfter(env, conv.id, Number(body.after_id) || 0) : [];
  return json(request, 200, {
    messages,
    team_online: await db.isTeamOnline(env),
    status: conv ? conv.status : 'open',
    handled_by: conv ? conv.handled_by : 'leo',
  });
}

async function handleEscalate(env, request, body) {
  const { conv, error } = await ownConversation(env, request, body, { create: true });
  if (error) return error;
  const note = String(body.user_message || '').slice(0, 1000).trim();
  const phone = String(body.phone || '').slice(0, 30).trim();
  const noteMsg = note ? await db.storeMessage(env, conv.id, 'user', note, { via: 'widget' }) : null;

  const r = await escalate(env, conv, { reason: String(body.reason || '').slice(0, 200), note, phone });
  return json(request, r.ok ? 200 : 502, {
    ok: r.ok,
    ghl_status: r.ghlStatus,
    emailed: r.emailed,
    user_id: noteMsg ? noteMsg.id : null,
    team_online: await db.isTeamOnline(env),
  });
}

// --- Ideas board -------------------------------------------------------------------

async function handleIdeas(env, request, path, body) {
  const me = body.context.user_email;
  switch (path) {
    case '/ideas':
      return json(request, 200, { ideas: await ideas.listIdeas(env, me, { sort: body.sort }), statuses: ideas.STATUSES });
    case '/ideas/get': {
      const data = await ideas.getIdea(env, body.id, me);
      return data ? json(request, 200, data) : json(request, 404, { error: 'not found' });
    }
    case '/ideas/similar':
      return json(request, 200, { ideas: await ideas.similarIdeas(env, String(body.text || '').slice(0, 500), me) });
    case '/ideas/new': {
      const r = await ideas.createIdea(env, body.context, { title: body.title, body: body.body });
      if (r.error) return json(request, 400, { error: r.error });
      const email = ideaNewEmail({ idea: r.row, adminUrl: ideaAdminUrl(env, r.row.id) });
      await sendEmails(env, teamEmails(env).map((to) => ({ kind: 'idea_new', to, ideaId: r.row.id, ...email })));
      return json(request, 200, await ideas.getIdea(env, r.row.id, me));
    }
    case '/ideas/vote': {
      const r = await ideas.setVote(env, body.id, body.context, !!body.on);
      return r ? json(request, 200, r) : json(request, 404, { error: 'not found' });
    }
    case '/ideas/comment': {
      const c = await ideas.addComment(
        env,
        body.id,
        { email: me, name: body.context.user_name, church: body.context.church },
        body.body
      );
      return c ? json(request, 200, { comment: ideas.publicComment(c, me) }) : json(request, 400, { error: 'empty comment' });
    }
  }
  return json(request, 404, { error: 'not found' });
}

// --- Routing -----------------------------------------------------------------------

const WIDGET_ROUTES = new Set(['/chat', '/messages', '/escalate', '/ideas', '/ideas/get', '/ideas/similar', '/ideas/new', '/ideas/vote', '/ideas/comment']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    try {
      if (url.pathname === '/health') return json(request, 200, { ok: true });
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return await handleAdmin(env, request, url);
      if (url.pathname.startsWith('/r/')) return await handleReplyPage(env, request, url);

      if (request.method !== 'POST' || !WIDGET_ROUTES.has(url.pathname)) {
        return json(request, 404, { error: 'not found' });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json(request, 400, { error: 'invalid JSON' });
      }
      const auth = await verifyContext(env, body.context);
      if (!auth.ok) return json(request, 401, { error: auth.error });

      if (url.pathname === '/chat') return await handleChat(env, request, body);
      if (url.pathname === '/messages') return await handleMessages(env, request, body);
      if (url.pathname === '/escalate') return await handleEscalate(env, request, body);
      return await handleIdeas(env, request, url.pathname, body);
    } catch (err) {
      console.error('helpdesk error', err);
      return json(request, 500, { error: 'internal error' });
    }
  },

  // Cloudflare Email Routing → replies to Leo's emails (docs/EMAIL-SETUP.md).
  async email(message, env, ctx) {
    const result = await receiveEmail(message, env);
    if (result.process) ctx.waitUntil(result.process().catch((err) => console.error('inbound email failed', err)));
  },
};
