// All conversation/message D1 queries in one place.

// What the church (and Leo) see. coach and note messages are team-only: never
// shown in the widget, emailed to the church, or fed to Leo as turns.
const VISIBLE = "role IN ('user', 'assistant', 'agent')";

export async function ensureConversation(env, id, context) {
  await env.DB.prepare(
    `INSERT INTO conversations (id, site, church, user_name, user_email)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')`
  )
    .bind(id, context.site, context.church || null, context.user_name || null, context.user_email)
    .run();
}

export async function getConversation(env, id) {
  return env.DB.prepare('SELECT * FROM conversations WHERE id = ?1').bind(id).first();
}

// A conversation id is a bearer secret held in one browser; also require the
// signed identity to match so a shared computer can't surface someone else's thread.
export function belongsTo(conv, context) {
  return (
    conv.site === context.site &&
    String(conv.user_email || '').toLowerCase() === String(context.user_email || '').toLowerCase()
  );
}

export async function storeMessage(env, conversationId, role, content, { via = null, author = null } = {}) {
  const { results } = await env.DB.prepare(
    `INSERT INTO messages (conversation_id, role, content, via, author) VALUES (?1, ?2, ?3, ?4, ?5)
     RETURNING id, role, content, via, author, created_at`
  )
    .bind(conversationId, role, content, via, author)
    .all();
  await env.DB.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?1").bind(conversationId).run();
  return results[0];
}

export async function loadHistory(env, conversationId, limit = 20) {
  const { results } = await env.DB.prepare(
    `SELECT role, content FROM messages WHERE conversation_id = ?1 AND ${VISIBLE} ORDER BY id DESC LIMIT ?2`
  )
    .bind(conversationId, limit)
    .all();
  return results.reverse();
}

export async function firstUserMessage(env, conversationId) {
  const row = await env.DB.prepare(
    "SELECT content FROM messages WHERE conversation_id = ?1 AND role = 'user' ORDER BY id LIMIT 1"
  )
    .bind(conversationId)
    .first();
  return row ? row.content : '';
}

// Throttled: the widget polls every few seconds while open.
export async function touchClient(env, conversationId) {
  await env.DB.prepare(
    `UPDATE conversations SET client_last_seen = datetime('now')
     WHERE id = ?1 AND (client_last_seen IS NULL OR client_last_seen < datetime('now', '-20 seconds'))`
  )
    .bind(conversationId)
    .run();
}

// Is the church still looking at the chat? If not, replies go out by email.
export function isClientActive(conv, seconds = 60) {
  if (!conv || !conv.client_last_seen) return false;
  const seen = Date.parse(conv.client_last_seen.replace(' ', 'T') + 'Z');
  return Number.isFinite(seen) && Date.now() - seen < seconds * 1000;
}

// Everything, team-only messages included — for the inbox and reply page.
export async function messagesAfter(env, conversationId, afterId) {
  const { results } = await env.DB.prepare(
    'SELECT id, role, content, via, author, created_at FROM messages WHERE conversation_id = ?1 AND id > ?2 ORDER BY id'
  )
    .bind(conversationId, afterId)
    .all();
  return results;
}

// What the widget may show.
export async function visibleMessagesAfter(env, conversationId, afterId) {
  const { results } = await env.DB.prepare(
    `SELECT id, role, content, via, created_at FROM messages
     WHERE conversation_id = ?1 AND id > ?2 AND ${VISIBLE} ORDER BY id`
  )
    .bind(conversationId, afterId)
    .all();
  return results;
}

export async function setStatus(env, conversationId, status) {
  await env.DB.prepare("UPDATE conversations SET status = ?2, updated_at = datetime('now') WHERE id = ?1")
    .bind(conversationId, status)
    .run();
}

export async function setHandledBy(env, conversationId, handledBy) {
  await env.DB.prepare("UPDATE conversations SET handled_by = ?2, updated_at = datetime('now') WHERE id = ?1")
    .bind(conversationId, handledBy)
    .run();
}

export async function markAgentRead(env, conversationId) {
  await env.DB.prepare(
    `UPDATE conversations SET agent_last_read_id =
       COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id = ?1), 0)
     WHERE id = ?1`
  )
    .bind(conversationId)
    .run();
}

// Unread tracking and snippets only count what the church or Leo said —
// the team's own notes and coaching never make a thread look new.
export async function listConversations(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.site, c.church, c.user_name, c.user_email, c.status, c.handled_by,
            c.agent_last_read_id, c.client_last_seen, c.created_at,
            COUNT(m.id) AS msg_count,
            MAX(m.id) AS last_id,
            MAX(m.created_at) AS last_at,
            (SELECT content FROM messages WHERE conversation_id = c.id AND ${VISIBLE} ORDER BY id DESC LIMIT 1) AS last_snippet,
            (SELECT role FROM messages WHERE conversation_id = c.id AND ${VISIBLE} ORDER BY id DESC LIMIT 1) AS last_role
     FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id AND m.${VISIBLE}
     GROUP BY c.id ORDER BY COALESCE(MAX(m.id), 0) DESC, c.created_at DESC LIMIT 200`
  ).all();
  return results;
}

export async function listEscalations(env, conversationId) {
  const { results } = await env.DB.prepare(
    'SELECT reason, ghl_status, created_at FROM escalations WHERE conversation_id = ?1 ORDER BY id'
  )
    .bind(conversationId)
    .all();
  return results;
}

export async function recordEscalation(env, conversationId, reason, ghlStatus) {
  await env.DB.prepare('INSERT INTO escalations (conversation_id, reason, ghl_status) VALUES (?1, ?2, ?3)')
    .bind(conversationId, reason, ghlStatus)
    .run();
}

export async function setPresence(env, online, minutes = 5) {
  if (online) {
    await env.DB.prepare(`UPDATE presence SET online_until = datetime('now', '+' || ?1 || ' minutes') WHERE id = 1`)
      .bind(minutes)
      .run();
  } else {
    await env.DB.prepare('UPDATE presence SET online_until = NULL WHERE id = 1').run();
  }
}

export async function isTeamOnline(env) {
  const row = await env.DB.prepare(
    "SELECT 1 AS online FROM presence WHERE id = 1 AND online_until IS NOT NULL AND online_until > datetime('now')"
  ).first();
  return !!row;
}
