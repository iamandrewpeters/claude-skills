// Leo's memory: answers the team has taught it. Stored as generalized Q&A
// (no church names or personal details) and fed into future chats when a new
// question matches.

import { overlap, tokenSet } from './text.js';

const MAX_Q = 300;
const MAX_A = 4000;

export async function createMemory(env, { question, answer, sourceConversationId, createdVia }) {
  const { results } = await env.DB.prepare(
    `INSERT INTO memories (question, answer, source_conversation_id, created_via)
     VALUES (?1, ?2, ?3, ?4) RETURNING *`
  )
    .bind(
      String(question).trim().slice(0, MAX_Q),
      String(answer).trim().slice(0, MAX_A),
      sourceConversationId || null,
      createdVia || 'manual'
    )
    .all();
  return results[0];
}

export async function listMemories(env) {
  const { results } = await env.DB.prepare('SELECT * FROM memories ORDER BY id DESC').all();
  return results;
}

export async function updateMemory(env, id, { question, answer, enabled }) {
  const current = await env.DB.prepare('SELECT * FROM memories WHERE id = ?1').bind(id).first();
  if (!current) return null;
  const { results } = await env.DB.prepare(
    `UPDATE memories SET question = ?2, answer = ?3, enabled = ?4, updated_at = datetime('now')
     WHERE id = ?1 RETURNING *`
  )
    .bind(
      id,
      question !== undefined ? String(question).trim().slice(0, MAX_Q) : current.question,
      answer !== undefined ? String(answer).trim().slice(0, MAX_A) : current.answer,
      enabled !== undefined ? (enabled ? 1 : 0) : current.enabled
    )
    .all();
  return results[0];
}

export async function deleteMemory(env, id) {
  await env.DB.prepare('DELETE FROM memories WHERE id = ?1').bind(id).run();
}

// Question matches count triple: they're phrased the way a church would ask.
export async function relevantMemories(env, query, limit = 3) {
  const q = tokenSet(query);
  if (!q.size) return [];
  const { results } = await env.DB.prepare('SELECT id, question, answer FROM memories WHERE enabled = 1').all();
  const top = results
    .map((m) => ({ m, score: overlap(q, m.question) * 3 + overlap(q, m.answer) }))
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.m);
  if (top.length) {
    await env.DB.prepare(
      `UPDATE memories SET match_count = match_count + 1, last_matched_at = datetime('now')
       WHERE id IN (${top.map((_, i) => `?${i + 1}`).join(', ')})`
    )
      .bind(...top.map((m) => m.id))
      .run();
  }
  return top;
}

export function memoryBlock(memories) {
  if (!memories.length) return '';
  return memories.map((m) => `Q: ${m.question}\nA: ${m.answer}`).join('\n\n');
}
