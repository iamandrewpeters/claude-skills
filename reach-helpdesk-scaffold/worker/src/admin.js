// Read-only ticket tracking: /admin (conversation list) and
// /admin/conversation?id=… (transcript). Gated by the ADMIN_KEY secret
// (?key=…). GHL Conversations stays the inbox where replies happen — this is
// the log/audit view over D1. Upgrade path for auth: Cloudflare Access.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(title, body) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;background:#f6f7f7;color:#1d2327}
      header{background:#2271b1;color:#fff;padding:14px 24px;font-weight:600}
      header a{color:#fff;text-decoration:none}
      main{padding:24px;max-width:960px;margin:0 auto}
      table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dcdcde;font-size:14px}
      th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #f0f0f1}
      th{background:#f6f7f7;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#646970}
      tr:hover td{background:#f6f9fc}
      a{color:#2271b1}
      .pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600}
      .pill-open{background:#e5f1f8;color:#2271b1}.pill-escalated{background:#fcf0f1;color:#b32d2e}.pill-resolved{background:#edfaef;color:#00844a}
      .msg{max-width:75%;padding:10px 13px;border-radius:10px;margin:8px 0;font-size:14px;line-height:1.5;white-space:pre-wrap}
      .msg-user{background:#2271b1;color:#fff;margin-left:auto;border-bottom-right-radius:3px}
      .msg-assistant{background:#fff;border:1px solid #dcdcde;border-bottom-left-radius:3px}
      .thread{display:flex;flex-direction:column}
      .meta{background:#fff;border:1px solid #dcdcde;padding:12px 16px;margin-bottom:16px;font-size:14px}
      .esc-note{background:#fcf9e8;border:1px solid #dba617;padding:10px 14px;margin:12px 0;font-size:13px}
      .muted{color:#646970;font-size:12px}
    </style></head><body><header><a href="admin?key=KEYPLACEHOLDER">🛟 Reach Helpdesk — conversations</a></header><main>${body}</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

function pill(status) {
  return `<span class="pill pill-${esc(status)}">${esc(status)}</span>`;
}

async function listView(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.site, c.church, c.user_name, c.user_email, c.status, c.created_at,
            COUNT(m.id) AS msg_count, MAX(m.created_at) AS last_at
     FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
     GROUP BY c.id ORDER BY last_at DESC LIMIT 200`
  ).all();

  const rows = results
    .map(
      (r) => `<tr>
        <td><a href="admin/conversation?id=${encodeURIComponent(r.id)}&key=KEYPLACEHOLDER">${esc(r.church || r.site)}</a></td>
        <td>${esc(r.user_name || '')}<div class="muted">${esc(r.user_email || '')}</div></td>
        <td>${pill(r.status)}</td>
        <td>${Number(r.msg_count) || 0}</td>
        <td class="muted">${esc(r.last_at || r.created_at)}</td>
      </tr>`
    )
    .join('');

  return page(
    'Helpdesk conversations',
    `<table><thead><tr><th>Church / site</th><th>Person</th><th>Status</th><th>Msgs</th><th>Last activity (UTC)</th></tr></thead>
     <tbody>${rows || '<tr><td colspan="5" class="muted">No conversations yet.</td></tr>'}</tbody></table>`
  );
}

async function conversationView(env, id) {
  const conv = (
    await env.DB.prepare('SELECT * FROM conversations WHERE id = ?1').bind(id).all()
  ).results[0];
  if (!conv) return page('Not found', '<p>Conversation not found.</p>');

  const { results: msgs } = await env.DB.prepare(
    'SELECT role, content, created_at FROM messages WHERE conversation_id = ?1 ORDER BY id'
  )
    .bind(id)
    .all();
  const { results: escs } = await env.DB.prepare(
    'SELECT reason, ghl_status, created_at FROM escalations WHERE conversation_id = ?1 ORDER BY id'
  )
    .bind(id)
    .all();

  const meta = `<div class="meta"><strong>${esc(conv.church || conv.site)}</strong> — ${esc(conv.user_name || '')} &lt;${esc(conv.user_email || '')}&gt;
    · ${pill(conv.status)} · started ${esc(conv.created_at)} UTC · <a href="${esc(conv.site)}" rel="noopener">${esc(conv.site)}</a></div>`;
  const escNotes = escs
    .map((e) => `<div class="esc-note">⚡ Escalated ${esc(e.created_at)} UTC — ${esc(e.reason)} (GHL webhook: ${esc(e.ghl_status)})</div>`)
    .join('');
  const thread = msgs
    .map((m) => `<div class="msg msg-${esc(m.role)}">${esc(m.content)}<div class="muted">${esc(m.created_at)} UTC</div></div>`)
    .join('');

  return page('Conversation', `${meta}${escNotes}<div class="thread">${thread}</div>`);
}

export async function handleAdmin(env, request, url) {
  const key = url.searchParams.get('key') || '';
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }
  let res;
  if (url.pathname === '/admin') res = await listView(env);
  else if (url.pathname === '/admin/conversation') res = await conversationView(env, url.searchParams.get('id') || '');
  else return new Response('Not found', { status: 404 });

  // Keep links working without re-typing the key.
  const html = (await res.text()).replaceAll('KEYPLACEHOLDER', encodeURIComponent(key));
  return new Response(html, { status: res.status, headers: res.headers });
}
