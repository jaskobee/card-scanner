// Duplicate detection. See CLAUDE.md §7 — surfaced, never auto-deleted.

import { fold } from './normalize.js';

/**
 * Identity key for a card. Two cards are the "same card" when the identifying
 * fields agree. Condition, price and quantity are deliberately excluded: the
 * same card in two conditions is two listings, not a duplicate.
 */
export function identityKey(card, valueOf) {
  const parts = ['set', 'number', 'name', 'variant', 'language'].map((f) => {
    const v = valueOf(card, f);
    return v == null ? '' : fold(v);
  });
  return parts.every((p) => p === '') ? null : parts.join('|');
}

/**
 * Group cards by identity. Returns only groups of two or more, largest first.
 * Cards with no identifying evidence are never grouped — we do not claim two
 * unidentified cards are the same card.
 */
export function findDuplicates(cards, valueOf) {
  const groups = new Map();
  for (const card of cards) {
    const key = identityKey(card, valueOf);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, cards: group, count: group.length }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Exact-image duplicates: the same file uploaded twice. Cheap, certain, and
 * worth catching before any processing is spent on it.
 */
export function findImageDuplicates(cards) {
  const byHash = new Map();
  for (const card of cards) {
    const h = card.meta?.hash;
    if (!h) continue;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(card);
  }
  return [...byHash.values()].filter((g) => g.length > 1);
}

/**
 * Merge a duplicate group into one card carrying the total quantity.
 * The survivor is the highest-confidence card; the rest are returned for
 * removal so the caller — not this function — decides what happens to them.
 */
export function mergeToQuantity(group) {
  const sorted = [...group].sort((a, b) => b.confidence - a.confidence);
  const [keep, ...rest] = sorted;
  const quantity = group.reduce((n, c) => n + (Number(c.user?.quantity) || 1), 0);
  return {
    keep: { ...keep, user: { ...keep.user, quantity }, updatedAt: Date.now() },
    remove: rest.map((c) => c.id),
  };
}

/** Fast perceptual-ish hash of a downscaled image, for exact/near duplicates. */
export async function hashImageData(imageData) {
  const { data } = imageData;
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 16) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
