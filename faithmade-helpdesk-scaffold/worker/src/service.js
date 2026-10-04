// What happens when someone says something. The church (widget or email), the
// team (inbox, email, or reply link), and Leo all funnel through here, so the
// rules live in one place:
//
//   • Leo answers until a person takes over (handled_by = 'team').
//   • Coaching: the team tells Leo what to say. Leo replies to the church in
//     its own voice and remembers the answer for the next church that asks.
//   • Direct replies: the team's exact words, signed by the Faithmade team.
//   • Whatever reaches the church goes live to the widget if they're watching
//     it, or by email if they've left — and they can answer that email.

import * as db from './db.js';
import { askLeo, coachLeo } from './claude.js';
import { relevantDocs, kbBlock } from './kb.js';
import { createMemory, relevantMemories } from './memory.js';
import { escalateToGhl } from './ghl.js';
import { sendEmail, sendEmails, teamEmails, recentEmailCount, threadHeaders } from './email/send.js';
import * as tpl from './email/templates.js';
import { replyAddress, replyLinkUrl } from './tokens.js';

export const MESSAGE_MAX_CHARS = 4000;

const base = (env) => String(env.PUBLIC_URL || '').replace(/\/+$/, '');
export const inboxUrl = (env, convId) => `${base(env)}/admin#c=${encodeURIComponent(convId)}`;
export const memoryUrl = (env, id) => `${base(env)}/admin#memory=${id}`;
export const ideaAdminUrl = (env, id) => `${base(env)}/admin#idea=${id}`;

// Opens the widget (or one idea) in the church's own wp-admin.
export const dashboardUrl = (site, open = 'chat') => `${String(site || '').replace(/\/+$/, '')}/wp-admin/?fmhd=${open}`;

export const contextOf = (conv) => ({
  site: conv.site,
  church: conv.church,
  user_name: conv.user_name,
  user_email: conv.user_email,
});

const clean = (text) => String(text || '').trim().slice(0, MESSAGE_MAX_CHARS);

async function sendToTeam(env, kind, conv, email) {
  const replyTo = await replyAddress(env, 'leo', conv.id);
  const headers = threadHeaders(env, conv.id, 'team');
  return sendEmails(
    env,
    teamEmails(env).map((to) => ({ kind, to, ...email, replyTo, headers, conversationId: conv.id }))
  );
}

// --- The church says something ---------------------------------------------

/**
 * Stores the church's message and, unless a person owns the thread, gets
 * Leo's answer. Returns { userMsg, leoMsg?, reply, escalate?, idea? } — reply
 * is null when the team owns the thread (they've been told instead).
 */
export async function clientMessage(env, conv, content, { via = 'widget', context = null } = {}) {
  const text = clean(content);
  const userMsg = await db.storeMessage(env, conv.id, 'user', text, { via });
  if (conv.status === 'resolved') await db.setStatus(env, conv.id, 'open');

  if (conv.handled_by === 'team') {
    await notifyTeamFollowup(env, conv, text);
    return { userMsg, reply: null };
  }
  // Still waiting on the team: Leo keeps helping, and the team hears that
  // there's more to read.
  if (conv.status === 'escalated') await notifyTeamFollowup(env, conv, text);

  const history = await db.loadHistory(env, conv.id);
  const knowledge = { kb: kbBlock(relevantDocs(text)), memories: await relevantMemories(env, text) };
  const leo = await askLeo(env, context || contextOf(conv), history, knowledge);
  const leoMsg = await db.storeMessage(env, conv.id, 'assistant', leo.reply, { via });
  return { userMsg, leoMsg, ...leo };
}

// The church answered one of our emails. Leo's answer goes back by email;
// if Leo can't help, the team is brought in (there's no form to click in email).
export async function clientEmail(env, conv, content) {
  const result = await clientMessage(env, conv, content, { via: 'email' });
  if (result.reply === null) return result;
  const fresh = await db.getConversation(env, conv.id);
  await deliverToClient(env, fresh, result.reply, { fromTeam: false, force: true });
  if (result.escalate && fresh.status !== 'escalated') {
    await escalate(env, fresh, { reason: 'Leo couldn’t answer an email reply' });
  }
  return result;
}

export async function escalate(env, conv, { reason, note = '', phone = '' }) {
  const why = reason || 'User requested a human';
  const history = await db.loadHistory(env, conv.id);
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'USER' : m.role === 'agent' ? 'TEAM' : 'LEO'}: ${m.content}`)
    .join('\n');

  const ghlStatus = await escalateToGhl(env, {
    context: contextOf(conv),
    conversationId: conv.id,
    reason: why,
    userMessage: note,
    phone,
    transcript: transcript || '(no prior messages)',
  });
  await db.recordEscalation(env, conv.id, why + (note ? ` — client note: ${note}` : ''), ghlStatus);
  await db.setStatus(env, conv.id, 'escalated');

  const email = tpl.escalationEmail({
    conv,
    reason: why,
    note,
    phone,
    messages: history,
    replyUrl: await replyLinkUrl(env, conv.id, 'reply'),
    inboxUrl: inboxUrl(env, conv.id),
  });
  const sent = (await sendToTeam(env, 'escalation', conv, email)).filter((r) => r.status === 'sent').length;
  const ghlOk = ghlStatus >= 200 && ghlStatus < 300;
  // "Logged" emails (no provider configured) don't count: nobody was told.
  return { ok: ghlOk || sent > 0, ghlStatus, emailed: sent };
}

async function notifyTeamFollowup(env, conv, text) {
  if (await db.isTeamOnline(env)) return; // they're watching the inbox
  const recent = await recentEmailCount(env, conv.id, { kinds: ['escalation', 'followup'], minutes: 5 });
  if (recent > 0) return;
  const email = tpl.teamFollowupEmail({
    conv,
    message: text,
    messages: await db.loadHistory(env, conv.id, 12),
    replyUrl: await replyLinkUrl(env, conv.id, 'reply'),
    inboxUrl: inboxUrl(env, conv.id),
  });
  await sendToTeam(env, 'followup', conv, email);
}

// --- The team says something -------------------------------------------------

/** The team's exact words to the church, signed by the Faithmade team. */
export async function teamReply(env, conv, content, { via = 'inbox', author = null } = {}) {
  const text = clean(content);
  if (!text) return { ok: false, error: 'Write a reply first.' };
  const message = await db.storeMessage(env, conv.id, 'agent', text, { via, author });
  await db.setHandledBy(env, conv.id, 'team');
  await db.setStatus(env, conv.id, 'open');
  await db.markAgentRead(env, conv.id);
  const delivery = await deliverToClient(env, conv, text, { fromTeam: true });
  return { ok: true, message, delivery };
}

/** Team-only note on the thread. */
export async function addNote(env, conv, content, { via = 'inbox', author = null } = {}) {
  const text = clean(content);
  if (!text) return { ok: false, error: 'Write a note first.' };
  const message = await db.storeMessage(env, conv.id, 'note', text, { via, author });
  await db.markAgentRead(env, conv.id);
  return { ok: true, message };
}

/**
 * The team tells Leo how to answer. Leo replies to the church in its own
 * words, saves a generalized memory when the answer is reusable, and (for
 * email coaching) confirms back to whoever coached it.
 * Returns { ok, reply, memory, note, delivery } or { ok: false, error }.
 */
export async function coach(env, conv, guidance, { via = 'inbox', author = null, subject = '' } = {}) {
  const text = clean(guidance);
  if (!text) return { ok: false, error: 'Tell Leo what to say.' };
  await db.storeMessage(env, conv.id, 'coach', text, { via, author });

  const result = await coachLeo(env, conv, await db.loadHistory(env, conv.id), text);
  if (result.error) {
    await db.storeMessage(env, conv.id, 'note', `Couldn’t use that guidance: ${result.error}`, { via, author: 'leo' });
    if (via === 'email' && author) {
      const email = tpl.coachFailedEmail({
        conv,
        subject,
        reason: `${result.error} Nothing was sent to the church — reply again, or answer them directly.`,
        replyUrl: await replyLinkUrl(env, conv.id, 'reply'),
      });
      await sendEmail(env, {
        kind: 'coach_failed',
        to: author,
        ...email,
        replyTo: await replyAddress(env, 'leo', conv.id),
        headers: threadHeaders(env, conv.id, 'team'),
        conversationId: conv.id,
      });
    }
    return { ok: false, error: result.error };
  }

  const reply = clean(result.reply_to_church);
  let delivery = null;
  if (reply) {
    await db.storeMessage(env, conv.id, 'assistant', reply, { via, author });
    await db.setHandledBy(env, conv.id, 'leo');
    await db.setStatus(env, conv.id, 'open');
    delivery = await deliverToClient(env, conv, reply, { fromTeam: false });
  }

  let memory = null;
  const question = String(result.memory_question || '').trim();
  const answer = String(result.memory_answer || '').trim();
  if (result.remember && question && answer) {
    memory = await createMemory(env, { question, answer, sourceConversationId: conv.id, createdVia: via });
  }

  const note = String(result.note_to_team || '').trim();
  if (note) await db.storeMessage(env, conv.id, 'note', note, { via, author: 'leo' });
  await db.markAgentRead(env, conv.id);

  if (via === 'email' && author) {
    const email = tpl.coachConfirmEmail({
      conv,
      subject,
      leoReply: reply,
      memory,
      note,
      inboxUrl: inboxUrl(env, conv.id),
      memoryUrl: memory ? memoryUrl(env, memory.id) : '',
    });
    await sendEmail(env, {
      kind: 'coach_confirm',
      to: author,
      ...email,
      replyTo: await replyAddress(env, 'leo', conv.id),
      headers: threadHeaders(env, conv.id, 'team'),
      conversationId: conv.id,
    });
  }
  return { ok: true, reply, memory, note, delivery };
}

// --- Getting it to the church ------------------------------------------------

/**
 * Live in the widget if the church is looking at it right now; otherwise by
 * email, with a Reply-To that brings their answer back into this thread.
 */
export async function deliverToClient(env, conv, message, { fromTeam = false, force = false } = {}) {
  if (!force && db.isClientActive(conv)) return { channel: 'widget' };
  if (!conv.user_email) return { channel: 'none' };
  const email = tpl.clientReplyEmail({
    conv,
    message,
    fromTeam,
    firstQuestion: await db.firstUserMessage(env, conv.id),
    dashboardUrl: dashboardUrl(conv.site),
  });
  const result = await sendEmail(env, {
    kind: fromTeam ? 'team_reply' : 'leo_reply',
    to: conv.user_email,
    ...email,
    replyTo: await replyAddress(env, 'chat', conv.id),
    headers: threadHeaders(env, conv.id, 'church'),
    conversationId: conv.id,
  });
  return { channel: 'email', status: result.status };
}
