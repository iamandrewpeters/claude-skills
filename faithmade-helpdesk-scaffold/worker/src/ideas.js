// The Ideas board: feature requests from every Faithmade church on one shared
// board. Churches post, vote, and comment from the widget; the team triages
// in the inbox, and voters hear back by email when an idea moves.
//
// Public shape is deliberately thin: churches see first names and their own
// posts, never other churches' email addresses.

import { tokenSet, overlap, firstName } from './text.js';

export const STATUSES = ['under_review', 'planned', 'in_progress', 'shipped', 'declined'];
const TITLE_MAX = 120;
const BODY_MAX = 4000;
const COMMENT_MAX = 2000;

const cut = (s, n) => String(s || '').trim().slice(0, n);
const lower = (s) => String(s || '').trim().toLowerCase();

// What a church sees for an idea.
function publicIdea(row, me) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    vote_count: row.vote_count,
    comment_count: row.comment_count,
    created_at: row.created_at,
    status_changed_at: row.status_changed_at,
    voted: !!row.voted,
    mine: !!me && lower(row.author_email) === lower(me),
  };
}

function publicComment(row, me) {
  return {
    id: row.id,
    body: row.body,
    is_team: !!row.is_team,
    author: row.is_team ? 'Faithmade team' : firstName(row.author_name) || 'A church',
    mine: !row.is_team && !!me && lower(row.author_email) === lower(me),
    created_at: row.created_at,
  };
}

async function recount(env, id) {
  await env.DB.prepare(
    `UPDATE ideas SET
       vote_count = (SELECT COUNT(*) FROM idea_votes WHERE idea_id = ?1),
       comment_count = (SELECT COUNT(*) FROM idea_comments WHERE idea_id = ?1),
       updated_at = datetime('now')
     WHERE id = ?1`
  )
    .bind(id)
    .run();
}

export async function getIdeaRow(env, id) {
  return env.DB.prepare('SELECT * FROM ideas WHERE id = ?1').bind(Number(id) || 0).first();
}

// --- Church-facing (widget) -----------------------------------------------------

export async function listIdeas(env, me, { sort = 'top' } = {}) {
  const order = sort === 'new' ? 'i.created_at DESC, i.id DESC' : 'i.vote_count DESC, i.created_at DESC';
  const { results } = await env.DB.prepare(
    `SELECT i.*, EXISTS(SELECT 1 FROM idea_votes v WHERE v.idea_id = i.id AND v.voter_email = ?1) AS voted
     FROM ideas i WHERE i.merged_into IS NULL ORDER BY ${order} LIMIT 300`
  )
    .bind(lower(me))
    .all();
  return results.map((r) => publicIdea(r, me));
}

export async function getIdea(env, id, me) {
  let row = await getIdeaRow(env, id);
  // Merged ideas forward to where their votes went.
  for (let hops = 0; row && row.merged_into && hops < 5; hops++) row = await getIdeaRow(env, row.merged_into);
  if (!row) return null;
  const voted = await env.DB.prepare('SELECT 1 AS v FROM idea_votes WHERE idea_id = ?1 AND voter_email = ?2')
    .bind(row.id, lower(me))
    .first();
  const { results } = await env.DB.prepare('SELECT * FROM idea_comments WHERE idea_id = ?1 ORDER BY id').bind(row.id).all();
  return { idea: publicIdea({ ...row, voted: !!voted }, me), comments: results.map((c) => publicComment(c, me)) };
}

/** context: the verified widget context. The author's vote is counted automatically. */
export async function createIdea(env, context, { title, body }) {
  const t = cut(title, TITLE_MAX);
  if (t.length < 4) return { error: 'Give your idea a short title.' };
  const { results } = await env.DB.prepare(
    `INSERT INTO ideas (title, body, author_email, author_name, church, site) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *`
  )
    .bind(t, cut(body, BODY_MAX), lower(context.user_email), context.user_name || null, context.church || null, context.site)
    .all();
  const row = results[0];
  await setVote(env, row.id, context, true);
  return { row: await getIdeaRow(env, row.id) };
}

export async function setVote(env, id, context, on) {
  const row = await getIdeaRow(env, id);
  if (!row || row.merged_into) return null;
  if (on) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO idea_votes (idea_id, voter_email, voter_name, church, site) VALUES (?1, ?2, ?3, ?4, ?5)`
    )
      .bind(row.id, lower(context.user_email), context.user_name || null, context.church || null, context.site)
      .run();
  } else {
    await env.DB.prepare('DELETE FROM idea_votes WHERE idea_id = ?1 AND voter_email = ?2')
      .bind(row.id, lower(context.user_email))
      .run();
  }
  await recount(env, row.id);
  const fresh = await getIdeaRow(env, row.id);
  return { vote_count: fresh.vote_count, voted: !!on };
}

export async function addComment(env, id, author, body) {
  const text = cut(body, COMMENT_MAX);
  const row = await getIdeaRow(env, id);
  if (!row || !text) return null;
  const { results } = await env.DB.prepare(
    `INSERT INTO idea_comments (idea_id, author_email, author_name, church, is_team, body)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *`
  )
    .bind(row.id, lower(author.email) || null, author.name || null, author.church || null, author.isTeam ? 1 : 0, text)
    .all();
  await recount(env, row.id);
  return results[0];
}

export { publicComment };

// "Someone may have asked already" — shown while a church types a new idea,
// so votes pile onto one idea instead of splitting across duplicates.
export async function similarIdeas(env, text, me, limit = 3) {
  const q = tokenSet(text);
  if (!q.size) return [];
  const { results } = await env.DB.prepare(
    `SELECT i.*, EXISTS(SELECT 1 FROM idea_votes v WHERE v.idea_id = i.id AND v.voter_email = ?1) AS voted
     FROM ideas i WHERE i.merged_into IS NULL AND i.status != 'declined'`
  )
    .bind(lower(me))
    .all();
  return results
    .map((r) => ({ r, score: overlap(q, r.title) * 2 + overlap(q, r.body) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || b.r.vote_count - a.r.vote_count)
    .slice(0, limit)
    .map((x) => publicIdea(x.r, me));
}

// --- Team-facing (inbox) ------------------------------------------------------------

export async function adminListIdeas(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, body, status, author_name, author_email, church, site, vote_count, comment_count,
            merged_into, status_changed_at, created_at, updated_at
     FROM ideas WHERE merged_into IS NULL ORDER BY vote_count DESC, created_at DESC`
  ).all();
  return results;
}

export async function adminGetIdea(env, id) {
  const idea = await getIdeaRow(env, id);
  if (!idea) return null;
  const comments = (await env.DB.prepare('SELECT * FROM idea_comments WHERE idea_id = ?1 ORDER BY id').bind(idea.id).all())
    .results;
  const voters = (
    await env.DB.prepare(
      'SELECT voter_email, voter_name, church, site, created_at FROM idea_votes WHERE idea_id = ?1 ORDER BY created_at'
    )
      .bind(idea.id)
      .all()
  ).results;
  return { idea, comments, voters };
}

export async function setIdeaStatus(env, id, status) {
  if (!STATUSES.includes(status)) return null;
  await env.DB.prepare(
    `UPDATE ideas SET status = ?2, status_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1`
  )
    .bind(Number(id) || 0, status)
    .run();
  return getIdeaRow(env, id);
}

export async function updateIdea(env, id, { title, body }) {
  const row = await getIdeaRow(env, id);
  if (!row) return null;
  await env.DB.prepare("UPDATE ideas SET title = ?2, body = ?3, updated_at = datetime('now') WHERE id = ?1")
    .bind(row.id, title !== undefined ? cut(title, TITLE_MAX) || row.title : row.title, body !== undefined ? cut(body, BODY_MAX) : row.body)
    .run();
  return getIdeaRow(env, row.id);
}

/** Folds a duplicate into another idea: votes (deduped) and comments move over. */
export async function mergeIdea(env, id, intoId) {
  const from = await getIdeaRow(env, id);
  const into = await getIdeaRow(env, intoId);
  if (!from || !into || from.id === into.id || into.merged_into) return null;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO idea_votes (idea_id, voter_email, voter_name, church, site, created_at)
       SELECT ?2, voter_email, voter_name, church, site, created_at FROM idea_votes WHERE idea_id = ?1`
    ).bind(from.id, into.id),
    env.DB.prepare('DELETE FROM idea_votes WHERE idea_id = ?1').bind(from.id),
    env.DB.prepare('UPDATE idea_comments SET idea_id = ?2 WHERE idea_id = ?1').bind(from.id, into.id),
    env.DB.prepare("UPDATE ideas SET merged_into = ?2, updated_at = datetime('now') WHERE id = ?1").bind(from.id, into.id),
  ]);
  await recount(env, from.id);
  await recount(env, into.id);
  return getIdeaRow(env, into.id);
}

export async function deleteIdea(env, id) {
  const row = await getIdeaRow(env, id);
  if (!row) return false;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM idea_votes WHERE idea_id = ?1').bind(row.id),
    env.DB.prepare('DELETE FROM idea_comments WHERE idea_id = ?1').bind(row.id),
    // Duplicates folded into it are empty stubs by now (their votes moved here).
    env.DB.prepare('DELETE FROM ideas WHERE merged_into = ?1').bind(row.id),
    env.DB.prepare('DELETE FROM ideas WHERE id = ?1').bind(row.id),
  ]);
  return true;
}

export async function ideaVoters(env, id) {
  const { results } = await env.DB.prepare('SELECT voter_email, voter_name, site FROM idea_votes WHERE idea_id = ?1')
    .bind(Number(id) || 0)
    .all();
  return results;
}
