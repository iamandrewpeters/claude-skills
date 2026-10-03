// Keyword matching shared by KB retrieval, Leo's memory, and duplicate-idea
// detection. Deliberately simple; Vectorize is the upgrade path if it outgrows this.

const STOPWORDS = new Set(
  (
    'a an and are as at be but by can do for how i in is it my of on or the to what when where why with you your ' +
    // domain words that appear in nearly every question and match everything
    'faithmade church site website page please help thanks thank hi hello hey need want get does our we us this ' +
    'that there have has just like know would could should will able way make add'
  ).split(' ')
);

export function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export const tokenSet = (text) => new Set(tokens(text));

// How many of `candidate`'s distinct tokens appear in the query set.
export function overlap(querySet, candidate) {
  let n = 0;
  for (const t of tokenSet(candidate)) if (querySet.has(t)) n++;
  return n;
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

export function truncate(text, n) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
