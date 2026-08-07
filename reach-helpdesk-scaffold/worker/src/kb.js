// Knowledge base: kb/*.md files bundled as text modules (wrangler [[rules]]).
// Retrieval is deliberately naive keyword-overlap ranking — plenty at current
// doc volume. If the KB outgrows the prompt, upgrade path is Vectorize.

import faithmadeGettingStarted from '../../kb/faithmade/getting-started.md';

// Register new kb/ files here until a glob build step exists (kb/README.md).
const KB_FILES = [
  { path: 'faithmade/getting-started.md', text: faithmadeGettingStarted },
];

const STOPWORDS = new Set(
  'a an and are as at be but by can do for how i in is it my of on or the to what when where why with you your'.split(' ')
);

function tokens(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export function relevantDocs(question, limit = 3) {
  const q = new Set(tokens(question));
  if (q.size === 0) return KB_FILES.slice(0, limit);
  return KB_FILES.map((doc) => {
    const docTokens = tokens(doc.text);
    let score = 0;
    for (const t of docTokens) if (q.has(t)) score++;
    // Favor tag/title hits
    const head = tokens(doc.text.split('\n').slice(0, 4).join(' '));
    for (const t of head) if (q.has(t)) score += 3;
    return { doc, score };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.doc);
}

export function kbBlock(docs) {
  if (docs.length === 0) return 'No knowledge-base articles matched this question.';
  return docs.map((d) => `--- ${d.path} ---\n${d.text.trim()}`).join('\n\n');
}
