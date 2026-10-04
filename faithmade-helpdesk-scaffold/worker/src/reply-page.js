// The "Reply to <name> directly" button in Leo's emails lands here: a signed,
// expiring link (tokens.js) to a phone-friendly page with the conversation and
// two ways to answer —
//   reply: the team's exact words, signed by the Faithmade team
//   coach: tell Leo what to say; Leo replies in its own words and remembers
// Plain HTML form + POST/redirect/GET, so it works without JavaScript.
//
//   GET  /r/<token>?mode=reply|coach[&sent=…&m=<memory id>&err=…]
//   POST /r/<token>   (form: mode, content)

import * as db from './db.js';
import { verifyReplyLinkToken } from './tokens.js';
import { coach, teamReply, inboxUrl } from './service.js';
import { firstName } from './text.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paras = (s) => esc(String(s || '').trim()).replace(/\n/g, '<br>');
const host = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  // The token is in the URL: never leak it to links clicked from this page.
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const page = (status, title, body) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap">
<style>${CSS}</style></head><body>${body}${SCRIPT}</body></html>`,
    { status, headers: HEADERS }
  );

const CSS = `
:root{--leo:#69af95;--deep:#4c8b73;--dark:#35604f;--soft:#edf5f1;--mist:#f4f8f6;--ink:#22302b;--muted:#6e7f78;--line:#e1e9e5;
  --card:#fff;--paper:#f0f4f2;--agent:#22302b;--amber:#b07a33;--amber-soft:#fbf3e4;--red:#a3453b;--red-soft:#f8eceb;--accent:#35604f}
@media (prefers-color-scheme:dark){:root{--soft:#1d322a;--mist:#111a16;--ink:#e6ede8;--muted:#8fa39a;--line:#26352e;--card:#16211c;
  --paper:#0d1512;--agent:#3b5449;--amber:#d9a45e;--amber-soft:#31281a;--red:#e08a80;--red-soft:#3a1f1c;--accent:#8fc7b2}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 'Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-text-size-adjust:100%}
.top{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#22302b;color:#fff}
.logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--leo),var(--dark));display:grid;place-items:center;font-weight:800;font-size:14px}
.top b{font-size:15px;letter-spacing:-.01em}.top span{color:#8fa79d;font-weight:500;font-size:13px}
main{max-width:640px;margin:0 auto;padding:16px 16px 40px}
.who{display:flex;gap:12px;align-items:center;margin:4px 0 14px}
.av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#69af95,#4c8b73);color:#fff;display:grid;place-items:center;font-weight:800;font-size:17px;flex-shrink:0}
.who h1{font-size:18px;line-height:1.25;margin:0;letter-spacing:-.01em}
.who p{margin:2px 0 0;color:var(--muted);font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.chip{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:5px 10px;border-radius:99px;background:var(--soft);color:var(--accent)}
.chip.escalated{background:var(--amber-soft);color:var(--amber)}.chip.away{background:var(--card);color:var(--muted);border:1px solid var(--line)}
.chip.live{background:var(--leo);color:#fff}
.banner{border-radius:14px;padding:13px 15px;margin:0 0 14px;font-size:14px}
.banner.ok{background:var(--soft);border:1px solid var(--leo)}.banner.err{background:var(--red-soft);color:var(--red)}
.banner strong{display:block;font-size:15px;margin-bottom:2px}
.learned{margin-top:10px;padding:11px 13px;border:1px dashed var(--leo);border-radius:12px;background:var(--card)}
.learned small{display:block;font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin-bottom:4px}
.thread{background:var(--mist);border:1px solid var(--line);border-radius:18px;padding:14px 12px;display:flex;flex-direction:column;gap:4px;margin:0 0 16px}
.lbl{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:8px 4px 3px}
.lbl.r{align-self:flex-end}
.b{max-width:86%;padding:10px 13px;border-radius:15px;font-size:14px;line-height:1.55;word-wrap:break-word}
.b.user{align-self:flex-start;background:var(--card);border:1px solid var(--line);border-bottom-left-radius:5px}
.b.assistant{align-self:flex-end;background:var(--soft);border-bottom-right-radius:5px}
.b.agent{align-self:flex-end;background:var(--agent);color:#fff;border-bottom-right-radius:5px}
.b.coach,.b.note{align-self:center;max-width:92%;font-size:13px;border-radius:12px}
.b.coach{background:var(--card);border:1.5px dashed var(--leo)}.b.note{background:var(--amber-soft)}
.b small{display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.75;margin-bottom:3px}
.empty{color:var(--muted);text-align:center;padding:18px;font-size:13px}
form{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px;box-shadow:0 6px 24px rgba(34,48,43,.08)}
.mi{position:absolute;opacity:0;pointer-events:none}
.modes{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--mist);border-radius:13px;padding:4px;margin-bottom:10px}
.modes label{display:block;text-align:center;padding:9px 8px;border-radius:10px;cursor:pointer;font-weight:700;font-size:14px;color:var(--muted);line-height:1.25}
.modes label small{display:block;font-weight:500;font-size:11.5px;margin-top:2px}
#m-reply:checked~.modes label[for=m-reply]{background:var(--agent);color:#fff}
#m-coach:checked~.modes label[for=m-coach]{background:linear-gradient(135deg,var(--deep),var(--dark));color:#fff}
#m-reply:focus-visible~.modes label[for=m-reply],#m-coach:focus-visible~.modes label[for=m-coach]{outline:3px solid var(--leo);outline-offset:2px}
.hint{margin:2px 2px 10px;font-size:13px;color:var(--muted)}
#m-reply:checked~.h-coach,#m-coach:checked~.h-reply,#m-reply:checked~button .t-coach,#m-coach:checked~button .t-reply{display:none}
textarea{display:block;width:100%;min-height:130px;resize:vertical;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--mist);color:var(--ink);font-size:15px;line-height:1.5;font-family:inherit;outline:none}
textarea:focus{border-color:var(--deep);background:var(--card);box-shadow:0 0 0 3px rgba(105,175,149,.2)}
button{margin-top:10px;width:100%;border:none;border-radius:12px;padding:14px;font-weight:700;font-size:15.5px;font-family:inherit;color:#fff;cursor:pointer;background:var(--agent)}
#m-coach:checked~button{background:linear-gradient(135deg,var(--deep),var(--dark))}
button[disabled]{opacity:.7;cursor:progress}
.foot{text-align:center;margin-top:18px;font-size:13px}.foot a{color:var(--accent);font-weight:700;text-decoration:none}
.gone{text-align:center;padding:60px 10px}.gone h1{font-size:21px;margin:14px 0 6px}.gone p{color:var(--muted);margin:0 0 20px}
.gone a{display:inline-block;background:var(--agent);color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px}
`;

// Progressive enhancement only: local times, a busy state while Leo writes.
const SCRIPT = `<script>
document.querySelectorAll('[data-ts]').forEach(function (el) {
  var d = new Date(el.getAttribute('data-ts').replace(' ', 'T') + 'Z');
  if (!isNaN(d)) el.textContent = d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
});
var f = document.querySelector('form');
if (f) f.addEventListener('submit', function () {
  var b = f.querySelector('button'), coach = f.querySelector('#m-coach').checked;
  setTimeout(function () { b.disabled = true; b.textContent = coach ? 'Leo is writing…' : 'Sending…'; }, 0);
});
var t = document.querySelector('.thread'); if (t) t.lastElementChild && t.lastElementChild.scrollIntoView({ block: 'end' });
</script>`;

const top = `<div class="top"><div class="logo">L</div><b>Faithmade Helpdesk</b><span>· Leo &amp; team</span></div>`;

function expired() {
  return page(
    404,
    'Link expired · Faithmade Helpdesk',
    `${top}<main class="gone"><div class="av" style="margin:0 auto">L</div><h1>This reply link has expired</h1>
<p>Reply links work for 14 days. You can still answer from the Helpdesk.</p><a href="/admin">Open the Helpdesk</a></main>`
  );
}

function bubble(m, conv) {
  const name = firstName(conv.user_name) || 'Church';
  const label = {
    user: name,
    assistant: m.author ? 'Leo · coached' : 'Leo',
    agent: 'Faithmade team',
    coach: 'Coached Leo',
    note: m.author === 'leo' ? 'Leo → team' : 'Team note',
  }[m.role];
  const time = `<span data-ts="${esc(m.created_at)}">${esc(m.created_at)} UTC</span>`;
  const via = m.via === 'email' ? ' · by email' : '';
  if (m.role === 'coach' || m.role === 'note') {
    return `<div class="b ${m.role}"><small>${esc(label)}${via}</small>${paras(m.content)}</div>`;
  }
  return `<div class="lbl${m.role === 'user' ? '' : ' r'}">${esc(label)} · ${time}${via}</div><div class="b ${esc(m.role)}">${paras(m.content)}</div>`;
}

async function render(env, conv, token, url) {
  const name = firstName(conv.user_name) || 'them';
  const mode = url.searchParams.get('mode') === 'coach' ? 'coach' : 'reply';
  const sent = url.searchParams.get('sent');
  const err = url.searchParams.get('err');
  const live = db.isClientActive(conv);

  let banner = '';
  if (err) banner = `<div class="banner err"><strong>Nothing was sent</strong>${esc(err)}</div>`;
  else if (sent === 'reply') {
    banner = `<div class="banner ok"><strong>✓ Sent to ${esc(name)}</strong>${live ? 'They’re in their dashboard — it appeared live in the chat.' : 'By email — their reply comes back into this conversation.'}</div>`;
  } else if (sent === 'coach') {
    const memory = await env.DB.prepare('SELECT * FROM memories WHERE id = ?1 AND source_conversation_id = ?2')
      .bind(Number(url.searchParams.get('m')) || 0, conv.id)
      .first();
    banner = `<div class="banner ok"><strong>✓ Leo replied to ${esc(name)}</strong>Its reply is the last message below.${
      memory
        ? `<div class="learned"><small>🧠 Leo learned</small><b>${esc(memory.question)}</b><br>${paras(memory.answer)}</div>`
        : ''
    }</div>`;
  }

  const messages = (await db.messagesAfter(env, conv.id, 0)).slice(-30);
  const status = conv.status === 'escalated' ? '<span class="chip escalated">Waiting on the team</span>' : `<span class="chip">${esc(conv.status)}</span>`;
  const presence = live ? '<span class="chip live">● In their dashboard now</span>' : '<span class="chip away">Away · replies go by email</span>';

  return page(
    200,
    `Reply to ${conv.user_name || conv.user_email} · Faithmade Helpdesk`,
    `${top}<main>
<div class="who"><div class="av">${esc((conv.user_name || conv.user_email || '?').trim()[0].toUpperCase())}</div>
<div><h1>${esc(conv.user_name || conv.user_email)}</h1><p>${esc(conv.church || 'A Faithmade church')} · ${esc(host(conv.site))}</p></div></div>
<div class="chips">${status}${presence}</div>
${banner}
<div class="thread">${messages.map((m) => bubble(m, conv)).join('') || '<div class="empty">No messages yet.</div>'}</div>
<form method="post" action="/r/${esc(token)}">
<input class="mi" type="radio" name="mode" value="reply" id="m-reply"${mode === 'reply' ? ' checked' : ''}>
<input class="mi" type="radio" name="mode" value="coach" id="m-coach"${mode === 'coach' ? ' checked' : ''}>
<div class="modes"><label for="m-reply">Reply to ${esc(name)}<small>Your exact words</small></label><label for="m-coach">Coach Leo<small>Leo answers + learns</small></label></div>
<p class="hint h-reply">${esc(name)} gets your exact words, signed by the Faithmade team${live ? ' — live in their chat' : ' — by email, since they’re not in their dashboard right now'}.</p>
<p class="hint h-coach">Tell Leo what to say. Leo replies to ${esc(name)} in its own words and remembers the answer for the next church that asks.</p>
<textarea name="content" required maxlength="4000" aria-label="Your message" placeholder="Write here…"></textarea>
<button type="submit"><span class="t-reply">Send to ${esc(name)}</span><span class="t-coach">Teach Leo</span></button>
</form>
<div class="foot"><a href="${esc(inboxUrl(env, conv.id))}">Open in the Helpdesk →</a></div>
</main>`
  );
}

export async function handleReplyPage(env, request, url) {
  const token = decodeURIComponent(url.pathname.slice('/r/'.length));
  const link = await verifyReplyLinkToken(env, token);
  const conv = link ? await db.getConversation(env, link.convId) : null;
  if (!conv) return expired();

  if (request.method === 'GET') return render(env, conv, token, url);
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const form = await request.formData();
  const mode = form.get('mode') === 'coach' ? 'coach' : 'reply';
  const content = String(form.get('content') || '');
  const result =
    mode === 'coach'
      ? await coach(env, conv, content, { via: 'link' })
      : await teamReply(env, conv, content, { via: 'link' });

  const next = new URL(`/r/${token}`, url);
  next.searchParams.set('mode', mode);
  if (result.ok) {
    next.searchParams.set('sent', mode);
    if (result.memory) next.searchParams.set('m', String(result.memory.id));
  } else {
    next.searchParams.set('err', result.error || 'Something went wrong.');
  }
  return new Response(null, { status: 303, headers: { location: next.pathname + next.search, 'cache-control': 'no-store' } });
}
