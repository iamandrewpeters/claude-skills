// Inbound email, via Cloudflare Email Routing (leo@ and chat@ on REPLY_DOMAIN,
// plus-addressed, → this Worker's email() handler). Two kinds of address,
// both signed (tokens.js):
//
//   leo+<conv>.<sig>@   the team replying to one of Leo's emails → coach Leo
//   chat+<conv>.<sig>@  the church replying to an answer we emailed → their next message
//
// The signed address proves the sender received our email; the From check
// proves they're who that email went to. Checks run first, so a bad message
// is bounced cheaply; the slow part (Claude) is returned as process().

import PostalMime from 'postal-mime';
import * as db from '../db.js';
import { parseReplyAddress } from '../tokens.js';
import { extractReply, htmlToText, isAutoReply } from './quote.js';
import { logEmail, teamEmails, recentEmailCount } from './send.js';
import { coach, clientEmail } from '../service.js';

const MAX_INBOUND_PER_10_MIN = 8; // backstop against mail loops

/**
 * message: Cloudflare ForwardableEmailMessage ({ from, to, headers, raw, setReject }).
 * Returns { status, reason?, process? } — process() does the work; the email()
 * handler awaits it.
 */
export async function receiveEmail(message, env) {
  const to = String(message.to || '').trim().toLowerCase();
  const envelopeFrom = String(message.from || '').trim().toLowerCase();

  let parsed;
  try {
    parsed = await PostalMime.parse(message.raw);
  } catch (err) {
    await logEmail(env, { direction: 'in', kind: 'unknown', to, from: envelopeFrom, status: 'rejected', error: 'unparseable' });
    message.setReject('Could not read this message');
    return { status: 'rejected', reason: 'unparseable' };
  }

  const from = String(parsed.from?.address || envelopeFrom).trim().toLowerCase();
  const subject = parsed.subject || '';
  const addr = await parseReplyAddress(env, to);
  const conv = addr ? await db.getConversation(env, addr.convId) : null;
  const kind = addr ? (addr.kind === 'leo' ? 'coach' : 'client_reply') : 'unknown';
  const body = extractReply(parsed.text || htmlToText(parsed.html || ''));

  const record = (status, error) =>
    logEmail(env, {
      direction: 'in',
      kind,
      conversationId: conv?.id,
      to,
      from,
      subject,
      text: body || null,
      status,
      error,
    });
  const reject = async (reason) => {
    await record('rejected', reason);
    message.setReject(reason);
    return { status: 'rejected', reason };
  };
  const ignore = async (reason) => {
    await record('ignored', reason);
    return { status: 'ignored', reason };
  };

  if (!addr || !conv) return reject('Unknown address');
  if (isAutoReply(message.headers, subject)) return ignore('auto-reply');
  if (/\bdmarc=fail\b/i.test(message.headers.get('authentication-results') || '')) return reject('Failed sender authentication');
  if ((await recentEmailCount(env, conv.id, { direction: 'in', minutes: 10 })) >= MAX_INBOUND_PER_10_MIN) {
    return ignore('rate limited');
  }

  if (addr.kind === 'leo') {
    const team = teamEmails(env);
    const author = [from, envelopeFrom].find((a) => team.includes(a));
    if (!author) return reject('Only the Faithmade team can coach Leo from this address');
    if (!body) return ignore('empty reply');
    await record('processed');
    return { status: 'processed', process: () => coach(env, conv, body, { via: 'email', author, subject }) };
  }

  const owner = String(conv.user_email || '').toLowerCase();
  if (!owner || (from !== owner && envelopeFrom !== owner)) {
    return reject('Please reply from the email address you used in your Faithmade dashboard');
  }
  if (!body) return ignore('empty reply');
  await record('processed');
  return { status: 'processed', process: () => clientEmail(env, conv, body) };
}
