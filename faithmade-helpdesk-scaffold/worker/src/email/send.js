// Outbound email. EMAIL_PROVIDER=resend (with RESEND_API_KEY) actually sends;
// anything else ("log", the default) only records — so nothing breaks before
// email is set up, and dev/tests never send real mail. Every message, in or
// out, lands in email_log, which backs the inbox's Email log.

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const RESEND = 'https://api.resend.com';
const BATCH_MAX = 100; // Resend's per-call batch limit

// Header values must be single-line; user text flows into subjects.
const oneLine = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

export const isEmail = (s) => EMAIL_RE.test(String(s || '').trim());

export const emailEnabled = (env) => env.EMAIL_PROVIDER === 'resend' && !!env.RESEND_API_KEY;

export function teamEmails(env) {
  return String(env.TEAM_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(isEmail);
}

export async function logEmail(env, row) {
  await env.DB.prepare(
    `INSERT INTO email_log (direction, kind, conversation_id, idea_id, to_addr, from_addr, reply_to, subject, html, text, status, provider_id, error)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
  )
    .bind(
      row.direction,
      row.kind,
      row.conversationId || null,
      row.ideaId || null,
      row.to || null,
      row.from || null,
      row.replyTo || null,
      row.subject || null,
      row.html || null,
      row.text || null,
      row.status,
      row.providerId || null,
      row.error || null
    )
    .run();
}

// How many emails went in or out for a conversation recently — the throttle
// that keeps a chatty thread from flooding inboxes, and the loop backstop.
export async function recentEmailCount(env, conversationId, { direction = 'out', kinds = null, minutes = 5 } = {}) {
  const kindFilter = kinds ? `AND kind IN (${kinds.map((_, i) => `?${i + 4}`).join(', ')})` : '';
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM email_log
     WHERE conversation_id = ?1 AND direction = ?2 AND created_at > datetime('now', '-' || ?3 || ' minutes') ${kindFilter}`
  )
    .bind(conversationId, direction, minutes, ...(kinds || []))
    .first();
  return row ? row.n : 0;
}

export async function listEmails(env, { conversationId = null, limit = 100 } = {}) {
  const where = conversationId ? 'WHERE conversation_id = ?2' : '';
  const { results } = await env.DB.prepare(
    `SELECT id, direction, kind, conversation_id, idea_id, to_addr, from_addr, reply_to, subject, status, error, created_at,
            substr(COALESCE(text, ''), 1, 160) AS preview
     FROM email_log ${where} ORDER BY id DESC LIMIT ?1`
  )
    .bind(...(conversationId ? [limit, conversationId] : [limit]))
    .all();
  return results;
}

export async function getEmail(env, id) {
  return env.DB.prepare('SELECT * FROM email_log WHERE id = ?1').bind(Number(id) || 0).first();
}

// Mail clients thread on References as well as the subject. Every email about
// one conversation cites the same (never actually sent) root id, so a church's
// emails stack into one thread and the team's into another.
export function threadHeaders(env, conversationId, audience) {
  const root = `<fmhd.${audience}.${conversationId}@${env.REPLY_DOMAIN || 'reply.faithmade.app'}>`;
  return { 'In-Reply-To': root, References: root };
}

function prepare(env, msg) {
  return {
    msg,
    from: env.EMAIL_FROM || 'Leo · Faithmade <leo@reply.faithmade.app>',
    to: String(msg.to || '').trim(),
    subject: oneLine(msg.subject).slice(0, 200),
  };
}

function resendPayload(p) {
  return {
    from: p.from,
    to: [p.to],
    subject: p.subject,
    html: p.msg.html,
    text: p.msg.text,
    reply_to: p.msg.replyTo || undefined,
    // Tells vacation responders not to answer (they'd otherwise reach Leo).
    headers: { 'Auto-Submitted': 'auto-generated', ...(p.msg.headers || {}) },
  };
}

async function resend(env, path, body) {
  const res = await fetch(RESEND + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function record(env, p, result) {
  await logEmail(env, {
    direction: 'out',
    kind: p.msg.kind,
    conversationId: p.msg.conversationId,
    ideaId: p.msg.ideaId,
    to: p.to,
    from: p.from,
    replyTo: p.msg.replyTo,
    subject: p.subject,
    html: p.msg.html,
    text: p.msg.text,
    status: result.status,
    providerId: result.providerId,
    error: result.error,
  });
  if (result.status === 'failed') console.error('email failed', p.msg.kind, p.to, result.error);
  return result;
}

/**
 * msg: { kind, to, subject, html, text, replyTo?, conversationId?, ideaId?, headers? }
 * Returns { status: 'sent' | 'logged' | 'failed', providerId?, error? }.
 */
export async function sendEmail(env, msg) {
  const p = prepare(env, msg);
  if (!isEmail(p.to)) return record(env, p, { status: 'failed', error: 'invalid recipient' });
  if (!emailEnabled(env)) return record(env, p, { status: 'logged' });
  try {
    const { res, data } = await resend(env, '/emails', resendPayload(p));
    return record(
      env,
      p,
      res.ok ? { status: 'sent', providerId: data.id || null } : { status: 'failed', error: data.message || `HTTP ${res.status}` }
    );
  } catch (err) {
    return record(env, p, { status: 'failed', error: String(err.message || err) });
  }
}

/**
 * Many emails at once (idea voters, the whole team) — one Resend batch call
 * per 100 instead of one request each, which would trip Resend's rate limit.
 */
export async function sendEmails(env, msgs) {
  if (msgs.length < 2 || !emailEnabled(env)) {
    const out = [];
    for (const m of msgs) out.push(await sendEmail(env, m));
    return out;
  }
  const prepared = msgs.map((m) => prepare(env, m));
  const out = new Array(prepared.length);
  const valid = [];
  for (let i = 0; i < prepared.length; i++) {
    if (isEmail(prepared[i].to)) valid.push(i);
    else out[i] = await record(env, prepared[i], { status: 'failed', error: 'invalid recipient' });
  }
  for (let start = 0; start < valid.length; start += BATCH_MAX) {
    const chunk = valid.slice(start, start + BATCH_MAX);
    let results;
    try {
      const { res, data } = await resend(env, '/emails/batch', chunk.map((i) => resendPayload(prepared[i])));
      const ids = Array.isArray(data.data) ? data.data : [];
      results = chunk.map((_, j) =>
        res.ok ? { status: 'sent', providerId: ids[j]?.id || null } : { status: 'failed', error: data.message || `HTTP ${res.status}` }
      );
    } catch (err) {
      results = chunk.map(() => ({ status: 'failed', error: String(err.message || err) }));
    }
    for (let j = 0; j < chunk.length; j++) out[chunk[j]] = await record(env, prepared[chunk[j]], results[j]);
  }
  return out;
}
