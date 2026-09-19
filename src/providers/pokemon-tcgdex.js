// Pokémon card data via TCGdex. See CLAUDE.md §2.3, §2.4.
// Free, open, no API key, multilingual (German included). Official public API —
// no scraping. Everything here is behind the provider interface so it can be
// replaced without touching the pipeline, the UI or the exporter.

import { RateLimiter } from '../queue.js';
import { fold } from '../normalize.js';

const BASE = 'https://api.tcgdex.net/v2';

export class PokemonTcgdexProvider {
  constructor({ language = 'en', fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
    this.id = 'tcgdex';
    this.label = 'TCGdex (Pokémon)';
    this.game = 'Pokémon';
    this.language = language;
    this.fetch = fetchImpl;
    this.limiter = new RateLimiter(6, 12); // deliberately polite to a free service
    this.cache = new Map();
    this.setIndex = null;
  }

  /** Card numbers on Pokémon cards are printed as x/y — a strong anchor. */
  get strongSignals() { return ['number', 'name']; }

  async #json(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    await this.limiter.take();
    const res = await this.fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
    if (res.status === 404) { this.cache.set(path, null); return null; }
    if (res.status === 429) {
      const e = new Error('The card database is rate limiting us. Slowing down.');
      e.retryable = true;
      throw e;
    }
    if (!res.ok) {
      const e = new Error(`Card database returned ${res.status}`);
      e.retryable = res.status >= 500;
      throw e;
    }
    const data = await res.json();
    this.cache.set(path, data);
    return data;
  }

  /** Set list, used to resolve a printed set total (the /y of x/y) to a set. */
  async sets() {
    if (this.setIndex) return this.setIndex;
    const raw = await this.#json(`/${this.language}/sets`);
    this.setIndex = (raw ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      total: s.cardCount?.official ?? s.cardCount?.total ?? null,
      releaseDate: s.releaseDate ?? null,
    }));
    return this.setIndex;
  }

  /**
   * Search candidates from OCR signals. Returns provider records in the shape
   * match.js expects. Never fabricates a record when nothing is found — an
   * empty array is a real answer.
   */
  async search(signals) {
    const results = new Map();

    // 1. Strongest path: printed number plus set total identifies a printing.
    if (signals.number) {
      const [num, den] = String(signals.number).split('/');
      const sets = await this.sets();
      const matchingSets = den
        ? sets.filter((s) => String(s.total) === String(Number(den)))
        : [];
      for (const set of matchingSets.slice(0, 12)) {
        const card = await this.#json(`/${this.language}/sets/${set.id}/${Number(num)}`).catch(() => null);
        if (card) results.set(card.id, this.#toRecord(card, set));
      }
    }

    // 2. Name search, which needs the number to disambiguate reprints.
    if (signals.name && results.size < 5) {
      const name = encodeURIComponent(signals.name);
      const list = await this.#json(`/${this.language}/cards?name=like:${name}`).catch(() => null);
      for (const brief of (list ?? []).slice(0, 15)) {
        if (results.has(brief.id)) continue;
        const card = await this.#json(`/${this.language}/cards/${brief.id}`).catch(() => null);
        if (card) results.set(card.id, this.#toRecord(card));
      }
    }

    return [...results.values()];
  }

  #toRecord(card, set) {
    const s = set ?? card.set ?? {};
    const total = s.cardCount?.official ?? s.total ?? null;
    const year = s.releaseDate ? Number(String(s.releaseDate).slice(0, 4)) : null;
    // A card has variants when the printing exists in more than one finish.
    const variants = card.variants ?? {};
    const variantCount = Object.values(variants).filter(Boolean).length;

    return {
      id: card.id,
      provider: this.id,
      name: card.name ?? null,
      number: total ? `${card.localId}/${total}` : String(card.localId ?? ''),
      set: s.name ?? null,
      setId: s.id ?? null,
      series: card.set?.serie?.name ?? null,
      year,
      manufacturer: 'Pokémon',
      game: 'Pokémon',
      language: this.language,
      rarity: card.rarity ?? null,
      image: card.image ? `${card.image}/low.webp` : null,
      // Which finishes this printing exists in — the UI offers these rather
      // than letting the app pick one.
      availableVariants: Object.entries(variants).filter(([, v]) => v).map(([k]) => k),
      hasVariants: variantCount > 1,
      variant: null, // never assumed from the database; it must be read or chosen
    };
  }

  /** Reference image for side-by-side verification in the review queue. */
  imageFor(record) { return record.image; }
}

/** Narrow a candidate list by a language hint without discarding evidence. */
export function preferLanguage(records, language) {
  if (!language) return records;
  const hit = records.filter((r) => fold(r.language) === fold(language));
  return hit.length ? hit : records;
}
