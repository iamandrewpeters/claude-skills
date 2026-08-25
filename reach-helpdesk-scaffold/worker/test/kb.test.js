import test from 'node:test';
import assert from 'node:assert/strict';
import { relevantDocs, kbBlock } from '../src/kb.js';

test('sermon question ranks the sermons doc first', () => {
  const docs = relevantDocs('How do I add a sermon and get it on our podcast?');
  assert.ok(docs.length > 0);
  assert.equal(docs[0].path, 'faithmade/sermons.md');
});

test('customizer question finds the colors doc', () => {
  const docs = relevantDocs('change the colors and fonts on my site');
  assert.ok(docs.some((d) => d.path === 'faithmade/site-colors-fonts.md'));
});

test('planning center question finds the sync doc', () => {
  const docs = relevantDocs('our planning center events are not syncing');
  assert.equal(docs[0].path, 'faithmade/planning-center.md');
});

test('limit is respected', () => {
  assert.ok(relevantDocs('sermon groups events colors planning center', 2).length <= 2);
});

test('kbBlock formats docs with path separators', () => {
  const block = kbBlock(relevantDocs('sermon'));
  assert.match(block, /--- faithmade\/sermons\.md ---/);
});

test('kbBlock handles no matches', () => {
  assert.match(kbBlock([]), /No knowledge-base articles matched/);
});
