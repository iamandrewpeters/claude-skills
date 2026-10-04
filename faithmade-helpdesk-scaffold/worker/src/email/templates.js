// Email templates. Email clients ignore <style> blocks and modern layout, so
// everything is tables + inline styles. Each returns { subject, html, text }.

import { firstName, truncate } from '../text.js';

const C = {
  leo: '#69af95',
  deep: '#4c8b73',
  dark: '#35604f',
  soft: '#edf5f1',
  mist: '#f4f8f6',
  ink: '#22302b',
  muted: '#6e7f78',
  line: '#e1e9e5',
  amber: '#b07a33',
  amberSoft: '#fbf3e4',
};
const FONT = `'Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

export const COACH_MARKER = '— Reply above this line to coach Leo —';
export const CLIENT_MARKER = '— Reply above this line to continue the conversation —';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paras = (s) => esc(String(s || '').trim()).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
const host = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const STATUS = {
  under_review: { label: 'Under review', color: C.muted, bg: '#eef1ef' },
  planned: { label: 'Planned', color: '#3d6f7a', bg: '#e6f1f3' },
  in_progress: { label: 'In progress', color: C.amber, bg: C.amberSoft },
  shipped: { label: 'Shipped', color: C.dark, bg: C.soft },
  declined: { label: 'Declined', color: '#a3453b', bg: '#f8eceb' },
};
export const statusLabel = (s) => (STATUS[s] || STATUS.under_review).label;

// Escalation reasons as people would say them.
const REASONS = {
  'Leo suggested escalation': 'Leo couldn’t answer',
  'User requested a human': 'Asked for a person',
};
export const reasonLabel = (r) => REASONS[r] || r || 'Leo couldn’t answer';

function layout({ preheader, marker, body, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${C.mist};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.mist};"><tr><td align="center" style="padding:24px 12px;">
${marker ? `<div style="font:12px ${FONT};color:${C.muted};padding:0 0 14px;">${esc(marker)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.line};border-radius:18px;">
<tr><td style="padding:28px 28px 26px;font:15px/1.6 ${FONT};color:${C.ink};">${body}</td></tr>
</table>
<div style="max-width:600px;font:12px/1.55 ${FONT};color:${C.muted};padding:16px 8px 0;">${footer || 'Faithmade Helpdesk · Leo, the Faithmade AI'}</div>
</td></tr></table></body></html>`;
}

function avatar(letter, team) {
  const bg = team ? C.ink : C.deep;
  return `<td width="48" valign="middle" style="padding:0 12px 0 0;"><div style="width:40px;height:40px;border-radius:20px;background:${bg};color:#ffffff;font:800 16px/40px ${FONT};text-align:center;">${letter}</div></td>`;
}

function header(title, sub, { letter = 'L', team = false } = {}) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr>${avatar(letter, team)}
<td valign="middle"><div style="font:700 15px/1.3 ${FONT};color:${C.ink};">${esc(title)}</div><div style="font:13px/1.4 ${FONT};color:${C.muted};">${esc(sub)}</div></td></tr></table>`;
}

function button(href, label, { dark = true } = {}) {
  const bg = dark ? C.ink : C.deep;
  return `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:#ffffff;font:700 15px/1 ${FONT};text-decoration:none;padding:14px 22px;border-radius:12px;">${esc(label)}</a>`;
}

function chip(text, color, bg) {
  return `<span style="display:inline-block;background:${bg};color:${color};font:700 11px/1 ${FONT};letter-spacing:.05em;text-transform:uppercase;padding:6px 10px;border-radius:99px;">${esc(text)}</span>`;
}

function transcriptHtml(messages, conv) {
  const who = (m) => (m.role === 'user' ? firstName(conv.user_name) || 'Church' : m.role === 'agent' ? 'You' : 'Leo');
  const style = (m) =>
    m.role === 'user'
      ? `background:#ffffff;border:1px solid ${C.line};color:${C.ink};`
      : m.role === 'agent'
        ? `background:${C.ink};color:#ffffff;`
        : `background:${C.soft};color:${C.ink};`;
  const rows = messages
    .map(
      (m) => `<tr><td style="padding:0 0 10px;">
<div style="font:700 10.5px/1 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${C.muted};padding:0 0 5px 2px;">${esc(who(m))}</div>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="${style(m)}border-radius:14px;padding:10px 14px;font:14px/1.55 ${FONT};">${paras(m.content)}</td></tr></table>
</td></tr>`
    )
    .join('');
  return `<div style="font:700 11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.muted};margin:22px 0 12px;">Conversation</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.mist};border-radius:14px;"><tr><td style="padding:16px 16px 6px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`;
}

function transcriptText(messages, conv) {
  return messages
    .map((m) => `${m.role === 'user' ? firstName(conv.user_name) || 'Church' : m.role === 'agent' ? 'You' : 'Leo'}: ${m.content}`)
    .join('\n\n');
}

function coachBox(name) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr>
<td style="background:${C.soft};border-left:4px solid ${C.deep};border-radius:12px;padding:16px 18px;font:14px/1.55 ${FONT};color:${C.ink};">
<div style="font:700 15px/1.4 ${FONT};color:${C.dark};padding:0 0 4px;">&#8617;&#xFE0E; Just reply to this email to coach Leo</div>
Tell Leo how to answer. Leo will reply to ${esc(name)} in its own words — and remember the answer for the next church that asks.
</td></tr></table>`;
}

function actions(name, replyUrl, inboxUrl) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0;"><tr><td>${button(replyUrl, `Reply to ${name} directly`)}</td></tr></table>
<div style="font:13px/1.5 ${FONT};color:${C.muted};margin:14px 0 0;">Your exact words go to ${esc(name)}, signed by the Faithmade team. · <a href="${esc(inboxUrl)}" style="color:${C.deep};font-weight:600;">Open in the Helpdesk</a></div>`;
}

function teamFooter(conv) {
  return `${esc(conv.church || 'A Faithmade church')} · ${esc(host(conv.site))} · ${esc(conv.user_email || '')}<br>Faithmade Helpdesk · sent by Leo`;
}

// --- To the team -----------------------------------------------------------

export function escalationEmail({ conv, reason, note, phone, messages, replyUrl, inboxUrl }) {
  const name = firstName(conv.user_name) || 'them';
  const fullName = conv.user_name || conv.user_email;
  // The subject names the topic (their first question); the preheader carries the latest.
  const asked = messages.find((m) => m.role === 'user')?.content || note || reasonLabel(reason);
  const latest = note || [...messages].reverse().find((m) => m.role === 'user')?.content || reasonLabel(reason);
  const subject = `Leo needs you · ${conv.church || 'A church'}: ${truncate(asked, 60)}`;
  const noteBox = note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;"><tr><td style="background:${C.amberSoft};border-radius:12px;padding:14px 16px;font:14px/1.55 ${FONT};color:${C.ink};"><div style="font:700 11px/1 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${C.amber};padding:0 0 6px;">${esc(name)}'s note</div>${paras(note)}</td></tr></table>`
    : '';
  const phoneLine = phone
    ? `<div style="font:14px/1.5 ${FONT};color:${C.ink};margin:12px 0 0;">&#128241; Prefers a text back: <a href="sms:${esc(phone)}" style="color:${C.deep};font-weight:700;">${esc(phone)}</a></div>`
    : '';
  const body = `${header('Leo needs you', `${conv.church || 'A Faithmade church'} · ${host(conv.site)}`)}
<div style="font:800 22px/1.3 ${FONT};color:${C.ink};margin:0 0 10px;">${esc(fullName)} needs a person</div>
${chip(reasonLabel(reason), C.amber, C.amberSoft)}
${noteBox}${phoneLine}
${transcriptHtml(messages.slice(-8), conv)}
${coachBox(name)}
${actions(name, replyUrl, inboxUrl)}`;
  const text = `${COACH_MARKER}

Leo needs you — ${fullName} (${conv.church || ''}, ${host(conv.site)}) needs a person.
Why: ${reasonLabel(reason)}
${note ? `\n${name}'s note: ${note}\n` : ''}${phone ? `Prefers a text back: ${phone}\n` : ''}
--- Conversation ---
${transcriptText(messages.slice(-8), conv)}

↩ Just reply to this email to coach Leo — Leo will reply to ${name} in its own words and remember the answer.
Or reply to ${name} directly (your exact words): ${replyUrl}
Open in the Helpdesk: ${inboxUrl}`;
  return { subject, html: layout({ preheader: truncate(latest, 110), marker: COACH_MARKER, body, footer: teamFooter(conv) }), text };
}

export function teamFollowupEmail({ conv, message, messages, replyUrl, inboxUrl }) {
  const name = firstName(conv.user_name) || 'They';
  const subject = `${name} replied · ${conv.church || 'A church'}: ${truncate(message, 60)}`;
  const body = `${header(`${conv.user_name || conv.user_email} replied`, `${conv.church || 'A Faithmade church'} · ${host(conv.site)}`, { letter: (name[0] || 'C').toUpperCase(), team: true })}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#ffffff;border:1px solid ${C.line};border-radius:14px;padding:14px 16px;font:15px/1.6 ${FONT};color:${C.ink};">${paras(message)}</td></tr></table>
${transcriptHtml(messages.slice(-6), conv)}
${coachBox(name)}
${actions(name, replyUrl, inboxUrl)}`;
  const text = `${COACH_MARKER}

${conv.user_name || conv.user_email} (${conv.church || ''}) replied:

${message}

↩ Just reply to this email to coach Leo. Or reply to ${name} directly: ${replyUrl}
Open in the Helpdesk: ${inboxUrl}`;
  return { subject, html: layout({ preheader: truncate(message, 110), marker: COACH_MARKER, body, footer: teamFooter(conv) }), text };
}

export function coachConfirmEmail({ conv, subject, leoReply, memory, note, inboxUrl, memoryUrl }) {
  const name = firstName(conv.user_name) || 'the church';
  const sent = leoReply
    ? `<div style="font:800 20px/1.3 ${FONT};color:${C.ink};margin:0 0 12px;">&#10003; Leo replied to ${esc(name)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${C.soft};border-radius:14px;padding:14px 16px;font:15px/1.6 ${FONT};color:${C.ink};">${paras(leoReply)}</td></tr></table>`
    : `<div style="font:800 20px/1.3 ${FONT};color:${C.ink};margin:0 0 12px;">Leo didn't send anything to ${esc(name)} yet</div>`;
  const learned = memory
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;"><tr><td style="border:1px dashed ${C.leo};border-radius:14px;padding:14px 16px;font:14px/1.55 ${FONT};color:${C.ink};">
<div style="font:700 11px/1 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${C.dark};padding:0 0 8px;">&#129504; Leo learned</div>
<div style="font-weight:700;padding:0 0 4px;">${esc(memory.question)}</div><div style="color:${C.muted};">${paras(memory.answer)}</div>
<div style="padding:10px 0 0;"><a href="${esc(memoryUrl)}" style="color:${C.deep};font-weight:700;font-size:13px;">Edit or remove in Leo's memory &rarr;</a></div></td></tr></table>`
    : `<div style="font:13px/1.5 ${FONT};color:${C.muted};margin:16px 0 0;">Nothing saved to Leo's memory for this one.</div>`;
  const noteLine = note ? `<div style="font:14px/1.55 ${FONT};color:${C.muted};margin:16px 0 0;"><strong style="color:${C.ink};">Leo:</strong> ${esc(note)}</div>` : '';
  const body = `${header('Leo', `${conv.church || 'A Faithmade church'} · ${host(conv.site)}`)}${sent}${learned}${noteLine}
<div style="font:13px/1.5 ${FONT};margin:20px 0 0;"><a href="${esc(inboxUrl)}" style="color:${C.deep};font-weight:600;">View the conversation &rarr;</a></div>`;
  const text = `${leoReply ? `Leo replied to ${name}:\n\n${leoReply}` : `Leo didn't send anything to ${name} yet.`}

${memory ? `Leo learned:\nQ: ${memory.question}\nA: ${memory.answer}\nEdit: ${memoryUrl}` : 'Nothing saved to memory.'}
${note ? `\nLeo: ${note}` : ''}
View the conversation: ${inboxUrl}`;
  return {
    subject: /^re:/i.test(subject || '') ? subject : `Re: ${subject || `Leo · ${conv.church || ''}`}`,
    html: layout({ preheader: leoReply ? `Leo replied to ${name}` : 'Leo needs more from you', body, footer: teamFooter(conv) }),
    text,
  };
}

export function coachFailedEmail({ conv, subject, reason, replyUrl }) {
  const name = firstName(conv.user_name) || 'them';
  const body = `${header('Leo', `${conv.church || 'A Faithmade church'} · ${host(conv.site)}`)}
<div style="font:800 20px/1.3 ${FONT};color:${C.ink};margin:0 0 10px;">Leo couldn't use that reply</div>
<div style="font:15px/1.6 ${FONT};color:${C.ink};">${esc(reason)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0;"><tr><td>${button(replyUrl, `Reply to ${name} directly`)}</td></tr></table>`;
  return {
    subject: /^re:/i.test(subject || '') ? subject : `Re: ${subject || 'Leo'}`,
    html: layout({ preheader: "Leo couldn't use that reply", body, footer: teamFooter(conv) }),
    text: `Leo couldn't use that reply: ${reason}\nReply to ${name} directly: ${replyUrl}`,
  };
}

// --- To the church -----------------------------------------------------------

// No "Hi Jane," here: Leo's replies and the team's notes carry their own greeting.
export function clientReplyEmail({ conv, message, fromTeam, firstQuestion, dashboardUrl }) {
  const sender = fromTeam ? 'The Faithmade team' : 'Leo, the Faithmade AI';
  const body = `${header(sender, `Replying to your question from ${conv.church || 'your dashboard'}`, { letter: fromTeam ? 'F' : 'L', team: fromTeam })}
<div style="font:15px/1.65 ${FONT};color:${C.ink};">${paras(message)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr><td>${button(dashboardUrl, 'Open your dashboard', { dark: false })}</td></tr></table>
<div style="font:13px/1.55 ${FONT};color:${C.muted};margin:16px 0 0;">Reply to this email to keep the conversation going${fromTeam ? '' : ' — Leo and the team will see it'}.</div>`;
  const subject = `Re: ${truncate(firstQuestion || 'your question', 70)}`;
  const text = `${CLIENT_MARKER}

${message}

— ${sender}

Open your dashboard: ${dashboardUrl}
Reply to this email to keep the conversation going.`;
  return {
    subject,
    html: layout({
      preheader: truncate(message, 110),
      marker: CLIENT_MARKER,
      body,
      footer: `You asked Leo a question from ${conv.church ? `the ${esc(conv.church)}` : 'your'} dashboard (${esc(host(conv.site))}).<br>Faithmade · church websites by The Reach Company`,
    }),
    text,
  };
}

export function ideaNewEmail({ idea, adminUrl }) {
  const who = [idea.author_name, idea.church].filter(Boolean).join(' · ') || 'A Faithmade church';
  const body = `${header('Faithmade Ideas', 'A church posted a new idea', { letter: 'F', team: true })}
<div style="font:800 21px/1.3 ${FONT};color:${C.ink};margin:0 0 6px;">${esc(idea.title)}</div>
<div style="font:13px/1.5 ${FONT};color:${C.muted};margin:0 0 14px;">${esc(who)} · ${esc(host(idea.site))}</div>
${idea.body ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${C.mist};border-radius:12px;padding:14px 16px;font:14px/1.6 ${FONT};color:${C.ink};">${paras(idea.body)}</td></tr></table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;"><tr><td>${button(adminUrl, 'Review on the Ideas board')}</td></tr></table>`;
  return {
    subject: `New idea · ${truncate(idea.title, 80)}`,
    html: layout({ preheader: truncate(idea.body || idea.title, 110), body }),
    text: `New idea from ${who}:\n\n${idea.title}\n\n${idea.body || ''}\n\nReview: ${adminUrl}`,
  };
}

export function ideaStatusEmail({ idea, status, note, ideaUrl, voterName }) {
  const s = STATUS[status] || STATUS.under_review;
  const name = firstName(voterName);
  const headline =
    status === 'shipped'
      ? 'An idea you voted for just shipped &#127881;'
      : `An idea you voted for is now ${esc(s.label.toLowerCase())}`;
  const body = `${header('Faithmade Ideas', 'Updates on ideas you voted for', { letter: 'F', team: true })}
${name ? `<div style="font:15px/1.6 ${FONT};color:${C.ink};margin:0 0 10px;">Hi ${esc(name)},</div>` : ''}
<div style="font:800 21px/1.3 ${FONT};color:${C.ink};margin:0 0 14px;">${headline}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border:1px solid ${C.line};border-radius:14px;padding:16px 18px;">
${chip(s.label, s.color, s.bg)}
<div style="font:700 17px/1.4 ${FONT};color:${C.ink};margin:10px 0 0;">${esc(idea.title)}</div>
<div style="font:13px/1.5 ${FONT};color:${C.muted};margin:4px 0 0;">${idea.vote_count} ${idea.vote_count === 1 ? 'vote' : 'votes'}</div>
</td></tr></table>
${note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;"><tr><td style="background:${C.soft};border-radius:12px;padding:14px 16px;font:14px/1.6 ${FONT};color:${C.ink};"><div style="font:700 11px/1 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${C.dark};padding:0 0 6px;">From the Faithmade team</div>${paras(note)}</td></tr></table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;"><tr><td>${button(ideaUrl, 'See the idea', { dark: false })}</td></tr></table>`;
  const text = `${name ? `Hi ${name},\n\n` : ''}${status === 'shipped' ? 'An idea you voted for just shipped!' : `An idea you voted for is now ${s.label.toLowerCase()}.`}

${idea.title} — ${s.label}
${note ? `\nFrom the Faithmade team: ${note}\n` : ''}
See the idea: ${ideaUrl}`;
  return {
    subject: `${status === 'shipped' ? 'Shipped' : s.label}: ${truncate(idea.title, 70)}`,
    html: layout({
      preheader: `${idea.title} is now ${s.label.toLowerCase()}`,
      body,
      footer: "You're getting this because you voted for this idea on the Faithmade Ideas board.",
    }),
    text,
  };
}
