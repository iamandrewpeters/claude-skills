// Knowledge base retrieval over kb/*.md (bundled via tools/build-kb.js →
// src/kb-data.js). Deliberately naive keyword-overlap ranking — plenty at
// current doc volume. If the KB outgrows the prompt, upgrade path is Vectorize.

import { KB_FILES } from './kb-data.js';
import { tokens, tokenSet } from './text.js';

export function relevantDocs(question, limit = 3) {
  const q = tokenSet(question);
  if (q.size === 0) return KB_FILES.slice(0, limit);
  return KB_FILES.map((doc) => {
    let score = 0;
    for (const t of tokens(doc.text)) if (q.has(t)) score++;
    // Favor tag/title hits
    for (const t of tokens(doc.text.split('\n').slice(0, 4).join(' '))) if (q.has(t)) score += 3;
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
