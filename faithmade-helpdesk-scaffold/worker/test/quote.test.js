import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReply, htmlToText, isAutoReply } from '../src/email/quote.js';

test('cuts at our "reply above this line" marker', () => {
  assert.equal(extractReply('Tell them yes.\n\n> — Reply above this line to coach Leo —\n> Leo needs you'), 'Tell them yes.');
});

test('cuts Gmail quote headers, including the wrapped two-line form', () => {
  assert.equal(extractReply('Sounds good.\n\nOn Sat, Oct 3, 2026 at 9:14 AM Leo wrote:\n> hi'), 'Sounds good.');
  assert.equal(extractReply('Sounds good.\n\nOn Sat, Oct 3, 2026 at 9:14 AM Leo · Faithmade <\nleo@reply.faithmade.app> wrote:\n> hi'), 'Sounds good.');
});

test('cuts Outlook headers and separators', () => {
  assert.equal(extractReply('Do it.\n\nFrom: Leo <leo@reply.faithmade.app>\nSent: Saturday\nTo: Andrew'), 'Do it.');
  assert.equal(extractReply('Do it.\n-----Original Message-----\nFrom: Leo'), 'Do it.');
  assert.equal(extractReply('Do it.\n________________________________\nFrom: Leo'), 'Do it.');
});

test('drops signatures and phone footers', () => {
  assert.equal(extractReply('Yes, refund it.\n\n-- \nAndrew Peters\nThe Reach Co'), 'Yes, refund it.');
  assert.equal(extractReply('On it.\n\nSent from my iPhone'), 'On it.');
});

test('keeps multi-paragraph replies intact', () => {
  const text = 'First, open Sermons.\n\nThen click Podcast Settings.\n\nThat’s it.';
  assert.equal(extractReply(text), text);
});

test('htmlToText strips the quoted part and markup', () => {
  const html = '<div>Tell them <b>yes</b> &amp; thanks</div><div><br></div><div class="gmail_quote">On Sat … wrote:<blockquote>old</blockquote></div>';
  assert.equal(htmlToText(html), 'Tell them yes & thanks');
});

test('isAutoReply spots vacation responders and bulk mail', () => {
  const h = (o) => new Headers(o);
  assert.equal(isAutoReply(h({ 'Auto-Submitted': 'auto-replied' }), 'Re: hi'), true);
  assert.equal(isAutoReply(h({ 'Auto-Submitted': 'no' }), 'Re: hi'), false);
  assert.equal(isAutoReply(h({ Precedence: 'bulk' }), 'Re: hi'), true);
  assert.equal(isAutoReply(h({ 'X-Autoreply': 'yes' }), 'Re: hi'), true);
  assert.equal(isAutoReply(h({}), 'Out of Office: Re: Leo needs you'), true);
  assert.equal(isAutoReply(h({}), 'Automatic reply: Re: hi'), true);
  assert.equal(isAutoReply(h({}), 'Re: Leo needs you'), false);
});
