// Pulls just the new text out of an email reply, dropping the quoted history,
// reply headers ("On … wrote:"), and signatures. Our own emails carry a
// "Reply above this line" marker, which makes the cut reliable; the other
// patterns cover Gmail, Apple Mail, and Outlook when the marker is missing.

const CUT_PATTERNS = [
  /reply above this line/i,
  /^\s*-{2,}\s*original message\s*-{2,}/i,
  /^\s*_{10,}\s*$/, // Outlook separator rule
  /^\s*on\b.*\bwrote:\s*$/i,
  /^\s*>/, // first quoted line
];

const SIGNATURE_PATTERNS = [/^--\s*$/, /^sent from my /i, /^get outlook for /i];

export function extractReply(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || '';
    if (CUT_PATTERNS.some((re) => re.test(line))) {
      cut = i;
      break;
    }
    // Gmail wraps long headers: "On Sat, Oct 3, 2026 at 9:14 AM Leo <" / "leo@…> wrote:"
    if (/^\s*on\b/i.test(line) && /wrote:\s*$/i.test(next) && !/^\s*>/.test(next)) {
      cut = i;
      break;
    }
    // Outlook header block: "From: …" followed by "Sent:" / "Date:" / "To:"
    if (/^\s*from:\s/i.test(line) && /^\s*(sent|date|to|subject):/i.test(next)) {
      cut = i;
      break;
    }
  }
  let kept = lines.slice(0, cut);
  const sig = kept.findIndex((l) => SIGNATURE_PATTERNS.some((re) => re.test(l.trim())));
  if (sig >= 0) kept = kept.slice(0, sig);
  return kept.join('\n').trim();
}

export function htmlToText(html) {
  let h = String(html || '');
  const quote = h.search(/<div[^>]*class="[^"]*gmail_quote|<blockquote/i);
  if (quote >= 0) h = h.slice(0, quote);
  return h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// RFC 3834 + the common vendor variants. Vacation responders must never be
// mistaken for coaching — Leo would forward "I'm out of office" to a church.
export function isAutoReply(headers, subject) {
  const get = (name) => String(headers.get(name) || '').toLowerCase();
  const auto = get('auto-submitted');
  if (auto && auto !== 'no') return true;
  if (headers.get('x-autoreply') || headers.get('x-autorespond')) return true;
  if (/^(bulk|junk|list|auto_reply)$/.test(get('precedence'))) return true;
  return /^(auto(matic)?[ -]?(reply|response)|out of (the )?office|ooo\b|away:)/i.test(String(subject || '').trim());
}
