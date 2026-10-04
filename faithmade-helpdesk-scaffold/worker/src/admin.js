// Faithmade Helpdesk inbox — the team's side.
//
//   GET  /admin                  the app (signed-in) or the sign-in page
//   GET  /admin?key=ADMIN_KEY    signs in, then redirects to a clean URL
//   POST /admin/login            form { key, hash } → session cookie
//   POST /admin/logout
//   /admin/api/*                 JSON API — session cookie, or an x-admin-key
//                                header for scripts
//
// Signing in sets a 30-day HttpOnly cookie (tokens.js), so links in emails
// (…/admin#c=<id>) never carry the admin key. SameSite=Lax plus JSON-only
// POSTs keep other sites from driving the API with that cookie.

import * as db from './db.js';
import * as ideas from './ideas.js';
import * as memory from './memory.js';
import { listEmails, getEmail, sendEmails, teamEmails, emailEnabled } from './email/send.js';
import { ideaStatusEmail } from './email/templates.js';
import { coach, teamReply, addNote, dashboardUrl } from './service.js';
import { adminSessionCookie, verifyAdminSession } from './tokens.js';
import { timingSafeEqual } from './crypto.js';
import { ADMIN_HTML } from './ui-data.js';

// Never framed — the inbox and sign-in page are clickjacking targets.
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'same-origin',
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const keyMatches = (env, key) => !!(env.ADMIN_KEY && key && timingSafeEqual(String(key), env.ADMIN_KEY));

async function signedIn(env, request) {
  if (keyMatches(env, request.headers.get('x-admin-key'))) return true;
  return env.TOKEN_SECRET ? verifyAdminSession(env, request.headers.get('cookie')) : false;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage(error = '') {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Sign in · Faithmade Helpdesk</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&display=swap">
<style>
:root{--ink:#22302b;--muted:#6e7f78;--line:#e1e9e5;--card:#fff;--paper:#f0f4f2;--leo:#69af95;--dark:#35604f}
@media (prefers-color-scheme:dark){:root{--ink:#e6ede8;--muted:#8fa39a;--line:#26352e;--card:#16211c;--paper:#0d1512}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:15px/1.5 'Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px}
form{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 12px 40px rgba(34,48,43,.12)}
.logo{width:44px;height:44px;border-radius:13px;background:linear-gradient(135deg,var(--leo),var(--dark));color:#fff;display:grid;place-items:center;font-weight:800;font-size:19px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 4px;letter-spacing:-.01em}p{margin:0 0 18px;color:var(--muted);font-size:14px}
input{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--paper);color:var(--ink);font-size:15px;font-family:inherit;outline:none}
input:focus{border-color:var(--leo);box-shadow:0 0 0 3px rgba(105,175,149,.2)}
button{margin-top:12px;width:100%;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#4c8b73,var(--dark));color:#fff;font-weight:700;font-size:15px;font-family:inherit;cursor:pointer}
.err{color:#c0574c;font-size:13px;font-weight:600;margin:10px 0 0}
</style></head><body>
<form method="post" action="/admin/login">
<div class="logo">L</div><h1>Faithmade Helpdesk</h1><p>Sign in to the team inbox.</p>
<input type="password" name="key" placeholder="Admin key" aria-label="Admin key" autocomplete="current-password" required autofocus>
<input type="hidden" name="hash" id="hash">
<button type="submit">Sign in</button>${error ? `<p class="err">${esc(error)}</p>` : ''}
</form>
<script>document.getElementById('hash').value = location.hash;</script>
</body></html>`,
    { status: error ? 401 : 200, headers: PAGE_HEADERS }
  );
}

async function startSession(env, url, hash = '') {
  const safeHash = /^#[\w=.:-]{0,80}$/.test(hash) ? hash : '';
  return new Response(null, {
    status: 303,
    headers: {
      location: `/admin${safeHash}`,
      'set-cookie': await adminSessionCookie(env, url.protocol === 'https:'),
      'cache-control': 'no-store',
    },
  });
}

// --- API ---------------------------------------------------------------------

async function conversationOr404(env, id) {
  return id ? db.getConversation(env, String(id)) : null;
}

async function notifyVoters(env, idea, status, note) {
  const voters = await ideas.ideaVoters(env, idea.id);
  const msgs = voters.map((v) => ({
    kind: 'idea_status',
    to: v.voter_email,
    ideaId: idea.id,
    ...ideaStatusEmail({ idea, status, note, ideaUrl: dashboardUrl(v.site, `idea-${idea.id}`), voterName: v.voter_name }),
  }));
  const results = await sendEmails(env, msgs);
  return { voters: voters.length, sent: results.filter((r) => r.status === 'sent').length };
}

async function api(env, request, url) {
  const path = url.pathname.slice('/admin/api/'.length);

  if (request.method === 'GET') {
    const q = url.searchParams;
    switch (path) {
      case 'config':
        return json(200, {
          email: emailEnabled(env) ? 'resend' : 'log',
          team_emails: teamEmails(env),
          reply_domain: env.REPLY_DOMAIN || 'reply.faithmade.app',
          public_url: env.PUBLIC_URL || '',
        });
      case 'conversations':
        return json(200, { conversations: await db.listConversations(env), team_online: await db.isTeamOnline(env) });
      case 'conversation': {
        const conv = await conversationOr404(env, q.get('id'));
        if (!conv) return json(404, { error: 'not found' });
        const [messages, escalations, emails] = await Promise.all([
          db.messagesAfter(env, conv.id, 0),
          db.listEscalations(env, conv.id),
          listEmails(env, { conversationId: conv.id, limit: 50 }),
        ]);
        await db.markAgentRead(env, conv.id);
        return json(200, { conversation: conv, messages, escalations, emails, client_active: db.isClientActive(conv) });
      }
      case 'ideas':
        return json(200, { ideas: await ideas.adminListIdeas(env) });
      case 'idea': {
        const data = await ideas.adminGetIdea(env, q.get('id'));
        return data ? json(200, data) : json(404, { error: 'not found' });
      }
      case 'memories':
        return json(200, { memories: await memory.listMemories(env) });
      case 'emails':
        return json(200, { emails: await listEmails(env, { conversationId: q.get('conversation') || null, limit: 200 }) });
      case 'email': {
        const email = await getEmail(env, q.get('id'));
        return email ? json(200, { email }) : json(404, { error: 'not found' });
      }
    }
    return json(404, { error: 'not found' });
  }

  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!String(request.headers.get('content-type') || '').includes('application/json')) {
    return json(415, { error: 'JSON only' });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid JSON' });
  }

  // Conversation actions
  if (['reply', 'coach', 'note', 'status', 'handoff'].includes(path)) {
    const conv = await conversationOr404(env, body.id);
    if (!conv) return json(404, { error: 'conversation not found' });
    if (path === 'reply') {
      const r = await teamReply(env, conv, body.content, { via: 'inbox' });
      return json(r.ok ? 200 : 400, r);
    }
    if (path === 'coach') {
      const r = await coach(env, conv, body.content, { via: 'inbox' });
      return json(r.ok ? 200 : 422, r);
    }
    if (path === 'note') {
      const r = await addNote(env, conv, body.content, { via: 'inbox' });
      return json(r.ok ? 200 : 400, r);
    }
    if (path === 'status') {
      if (!['open', 'resolved'].includes(body.status)) return json(400, { error: 'bad status' });
      await db.setStatus(env, conv.id, body.status);
      return json(200, { ok: true });
    }
    await db.setHandledBy(env, conv.id, 'leo');
    return json(200, { ok: true });
  }

  if (path === 'presence') {
    await db.setPresence(env, !!body.online);
    return json(200, { team_online: await db.isTeamOnline(env) });
  }

  // Ideas
  if (path === 'idea/status') {
    const before = await ideas.getIdeaRow(env, body.id);
    if (!before) return json(404, { error: 'idea not found' });
    const idea = await ideas.setIdeaStatus(env, before.id, body.status);
    if (!idea) return json(400, { error: 'bad status' });
    const note = String(body.note || '').trim();
    if (note) await ideas.addComment(env, idea.id, { isTeam: true, name: 'Faithmade team' }, note);
    const notified = body.notify ? await notifyVoters(env, idea, idea.status, note) : null;
    return json(200, { idea: await ideas.getIdeaRow(env, idea.id), notified });
  }
  if (path === 'idea/update') {
    const idea = await ideas.updateIdea(env, body.id, { title: body.title, body: body.body });
    return idea ? json(200, { idea }) : json(404, { error: 'idea not found' });
  }
  if (path === 'idea/comment') {
    const c = await ideas.addComment(env, body.id, { isTeam: true, name: 'Faithmade team' }, body.body);
    return c ? json(200, { comment: c }) : json(400, { error: 'idea not found or empty comment' });
  }
  if (path === 'idea/merge') {
    const idea = await ideas.mergeIdea(env, body.id, body.into);
    return idea ? json(200, { idea }) : json(400, { error: 'cannot merge those two' });
  }
  if (path === 'idea/delete') {
    return (await ideas.deleteIdea(env, body.id)) ? json(200, { ok: true }) : json(404, { error: 'idea not found' });
  }

  // Leo's memory
  if (path === 'memory/create') {
    if (!String(body.question || '').trim() || !String(body.answer || '').trim()) {
      return json(400, { error: 'question and answer required' });
    }
    return json(200, { memory: await memory.createMemory(env, { question: body.question, answer: body.answer, createdVia: 'manual' }) });
  }
  if (path === 'memory/update') {
    const m = await memory.updateMemory(env, Number(body.id), {
      question: body.question,
      answer: body.answer,
      enabled: body.enabled,
    });
    return m ? json(200, { memory: m }) : json(404, { error: 'memory not found' });
  }
  if (path === 'memory/delete') {
    await memory.deleteMemory(env, Number(body.id));
    return json(200, { ok: true });
  }

  return json(404, { error: 'not found' });
}

export async function handleAdmin(env, request, url) {
  if (url.pathname === '/admin/login' && request.method === 'POST') {
    const form = await request.formData();
    if (!keyMatches(env, form.get('key'))) return loginPage('That key didn’t match.');
    if (!env.TOKEN_SECRET) return loginPage('TOKEN_SECRET isn’t set on the Worker yet.');
    return startSession(env, url, String(form.get('hash') || ''));
  }
  if (url.pathname === '/admin/logout' && request.method === 'POST') {
    return new Response(null, {
      status: 303,
      headers: { location: '/admin', 'set-cookie': 'fmhd_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' },
    });
  }
  // Old bookmark style: trade the key for a session and drop it from the URL.
  if (url.pathname === '/admin' && url.searchParams.has('key')) {
    if (!keyMatches(env, url.searchParams.get('key')) || !env.TOKEN_SECRET) return loginPage('That key didn’t match.');
    return startSession(env, url);
  }

  const ok = await signedIn(env, request);
  if (url.pathname.startsWith('/admin/api/')) {
    return ok ? api(env, request, url) : json(401, { error: 'sign in required' });
  }
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    if (!ok) return loginPage();
    return new Response(ADMIN_HTML, { headers: PAGE_HEADERS });
  }
  return new Response('Not found', { status: 404 });
}
