// Combining what was read from the front of a card with what was read from its back.
//
// Each side is read on its own, by the same reader (generic.js), and this decides what
// the two readings say together. It never reads an image and never invents a value: it
// only chooses between, and agrees, readings that are already text with a place and a
// confidence. Two independent readings of the same name are better evidence than either
// alone, and that is the one thing a pair adds that a single photo cannot.
//
// Pure: it takes readings, so it is unit tested.

const lettersOf = (s) => String(s ?? '').replace(/[^A-Za-zÀ-ÿ0-9]/g, '').toLowerCase();

/** Edit distance between two strings, for telling a misread letter from a different name. */
export function distance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = keep;
    }
  }
  return prev[b.length];
}

/**
 * Do two readings say the same name? Equal letters do, one misread letter in nine does
 * ("BRAY WYATT" and "BRAY WATT"), and a surname alone matches the full name that ends with
 * it. Two short strings never match: "ELLIS" and "ELLA" differ by one letter and are not
 * the same person.
 */
export function sameName(a, b) {
  const x = lettersOf(a), y = lettersOf(b);
  if (!x || !y || Math.min(x.length, y.length) < 4) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))) return true;
  return Math.max(x.length, y.length) >= 7 && 1 - distance(x, y) / Math.max(x.length, y.length) >= 0.85;
}

/**
 * Names from both sides, best first. A name read on both sides is agreed: it takes the
 * surer of the two spellings (the longer, if one is only a surname), gains confidence
 * and ranks above everything read on one side alone.
 */
export function combineNames(frontNames = [], backNames = []) {
  const tag = (list, side) => list.map((n) => ({ ...n, side, sources: [{ side, text: n.text, confidence: n.confidence }] }));
  const front = tag(frontNames, 'front');
  const back = tag(backNames, 'back');
  const used = new Set();
  const pool = [];

  for (const a of front) {
    const at = back.findIndex((b, i) => !used.has(i) && sameName(a.text, b.text));
    if (at < 0) { pool.push(a); continue; }
    used.add(at);
    const b = back[at];
    // The surer spelling, unless the other is the fuller name (a surname read on one side, the
    // whole name on the other) and was not badly read.
    const fuller = (x, y) => lettersOf(x.text).length > lettersOf(y.text).length && lettersOf(x.text).includes(lettersOf(y.text));
    let chosen = a.confidence >= b.confidence ? a : b;
    const other = chosen === a ? b : a;
    if (fuller(other, chosen) && other.confidence >= 0.6) chosen = other;
    pool.push({
      ...chosen,
      confidence: Math.min(0.95, Math.max(a.confidence, b.confidence) + 0.1),
      score: Math.max(a.score ?? 0, b.score ?? 0) + 0.2,
      agreed: true,
      sources: [...a.sources, ...b.sources],
    });
  }
  back.forEach((b, i) => { if (!used.has(i)) pool.push(b); });
  return pool.sort((p, q) => (q.score ?? q.confidence) - (p.score ?? p.confidence));
}

/**
 * The better of two pieces of evidence for the same thing. A value printed as such beats one
 * inferred from where it sat, and otherwise the surer reading wins; the side it came from is
 * kept so the card can say where its value was read.
 */
function betterEvidence(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (Boolean(a.inferred) !== Boolean(b.inferred)) return a.inferred ? b : a;
  return b.confidence > a.confidence ? b : a;
}

/**
 * @param {{names: Array, evidence: object, texts: Array, framing?: string}|null} front
 * @param {{names: Array, evidence: object, texts: Array, framing?: string}|null} back
 * @returns {{names: Array, evidence: object, texts: Array, framing: string|undefined, sides: string[]}}
 */
export function combineSides(front, back) {
  const evidence = {};
  for (const key of new Set([...Object.keys(front?.evidence ?? {}), ...Object.keys(back?.evidence ?? {})])) {
    const f = front?.evidence?.[key] ? { ...front.evidence[key], side: 'front' } : null;
    const b = back?.evidence?.[key] ? { ...back.evidence[key], side: 'back' } : null;
    evidence[key] = betterEvidence(f, b);
  }

  const side = (list, s) => (list ?? []).map((t) => ({ ...t, side: s }));
  return {
    names: combineNames(front?.names, back?.names),
    evidence,
    // Everything read on either side, biggest first, each marked with its side.
    texts: [...side(front?.texts, 'front'), ...side(back?.texts, 'back')].sort((p, q) => (q.size ?? 0) - (p.size ?? 0)).slice(0, 36),
    framing: front?.framing ?? back?.framing,
    sides: [front && 'front', back && 'back'].filter(Boolean),
  };
}
