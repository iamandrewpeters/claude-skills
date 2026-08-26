// All D1 queries in one place.

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
  const { results } = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?1').bind(id).all();
  return results[0] || null;
}

export async function storeMessage(env, conversationId, role, content) {
  const res = await env.DB.prepare(
    'INSERT INTO messages (conversation_id, role, content) VALUES (?1, ?2, ?3) RETURNING id, role, content, created_at'
  )
    .bind(conversationId, role, content)
    .all();
  return res.results[0];
}

export async function loadHistory(env, conversationId, limit = 20) {
  const { results } = await env.DB.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY id DESC LIMIT ?2'
  )
    .bind(conversationId, limit)
    .all();
  return results.reverse();
}

export async function messagesAfter(env, conversationId, afterId) {
  const { results } = await env.DB.prepare(
    'SELECT id, role, content, created_at FROM messages WHERE conversation_id = ?1 AND id > ?2 ORDER BY id'
  )
    .bind(conversationId, afterId)
    .all();
  return results;
}

export async function setStatus(env, conversationId, status) {
  await env.DB.prepare(
    "UPDATE conversations SET status = ?2, updated_at = datetime('now') WHERE id = ?1"
  )
    .bind(conversationId, status)
    .run();
}

export async function setHandledBy(env, conversationId, handledBy) {
  await env.DB.prepare(
    "UPDATE conversations SET handled_by = ?2, updated_at = datetime('now') WHERE id = ?1"
  )
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

export async function listConversations(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.site, c.church, c.user_name, c.user_email, c.status, c.handled_by,
            c.agent_last_read_id, c.created_at,
            COUNT(m.id) AS msg_count,
            MAX(m.id) AS last_id,
            MAX(m.created_at) AS last_at,
            (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_snippet
     FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
     GROUP BY c.id ORDER BY last_id DESC LIMIT 200`
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
  await env.DB.prepare(
    'INSERT INTO escalations (conversation_id, reason, ghl_status) VALUES (?1, ?2, ?3)'
  )
    .bind(conversationId, reason, ghlStatus)
    .run();
}

export async function setPresence(env, online, minutes = 5) {
  if (online) {
    await env.DB.prepare(
      `UPDATE presence SET online_until = datetime('now', '+' || ?1 || ' minutes') WHERE id = 1`
    )
      .bind(minutes)
      .run();
  } else {
    await env.DB.prepare('UPDATE presence SET online_until = NULL WHERE id = 1').run();
  }
}

export async function isTeamOnline(env) {
  const { results } = await env.DB.prepare(
    "SELECT 1 AS online FROM presence WHERE id = 1 AND online_until IS NOT NULL AND online_until > datetime('now')"
  ).all();
  return results.length > 0;
}
