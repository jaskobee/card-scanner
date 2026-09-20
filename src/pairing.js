// Pairing the photo of a card's front with the photo of its back.
//
// Wrestling, sports and entertainment cards split what they say across both sides:
// the name and the picture on the front, the card number, the year and the maker on
// the back. So a card is two photos, and a pile of photos has to become a pile of pairs.
//
// Two ways, and never a silent guess between them:
//   * by file name, when every file says which side it is ("bray-front.jpg",
//     "bray-back.jpg", "vorne", "hinten"): a front goes with the back that has the
//     same name apart from that word;
//   * otherwise by order: the first with the second, the third with the fourth.
// The caller shows the pairs before anything is scanned and lets a person swap or remove
// any of them, because the order files arrive in depends on the computer they came from.
//
// Pure: it looks at names only, so it is unit tested.

const FRONT = 'front|vorne|vorderseite|fronte|avant|recto';
const BACK = 'back|hinten|rueckseite|rückseite|rear|verso|dos|retro|revers';

// The word has to stand alone among letters: "front1" and "bray_front" count, "frontier" does not.
const word = (list) => new RegExp(`(?<![a-zà-ÿ])(${list})(?![a-zà-ÿ])`, 'i');
const FRONT_RE = word(FRONT);
const BACK_RE = word(BACK);

const withoutExtension = (name) => String(name ?? '').replace(/\.[a-z0-9]{2,5}$/i, '');

/** 'front', 'back', or null when the name does not say. A name that says both says neither. */
export function sideOf(name) {
  const n = withoutExtension(name);
  const f = FRONT_RE.test(n), b = BACK_RE.test(n);
  if (f === b) return null;
  return f ? 'front' : 'back';
}

/** What is left of a name once the word for its side is taken out, for matching a front to its back. */
export function stemOf(name) {
  return withoutExtension(name)
    .replace(FRONT_RE, ' ').replace(BACK_RE, ' ')
    .toLowerCase().replace(/[\s._-]+/g, ' ').trim();
}

/**
 * @param {Array<{name: string}>} files in the order they were added
 * @returns {{pairs: Array<{front: object|null, back: object|null}>, method: 'names'|'order'}}
 *   `front` is null only for a back whose front is missing.
 */
export function pairPhotos(files) {
  const list = [...files];
  const sides = list.map((f) => sideOf(f.name));

  if (list.length && sides.every(Boolean)) {
    const fronts = list.filter((_, i) => sides[i] === 'front').map((f) => ({ f, stem: stemOf(f.name) }));
    const backs = list.filter((_, i) => sides[i] === 'back').map((f) => ({ f, stem: stemOf(f.name), used: false }));
    const pairs = fronts.map(({ f, stem }) => {
      const back = backs.find((b) => !b.used && b.stem === stem);
      if (back) back.used = true;
      return { front: f, back: back?.f ?? null };
    });
    for (const b of backs) if (!b.used) pairs.push({ front: null, back: b.f });
    return { pairs, method: 'names' };
  }

  const pairs = [];
  for (let i = 0; i < list.length; i += 2) pairs.push({ front: list[i], back: list[i + 1] ?? null });
  return { pairs, method: 'order' };
}

/** Swap the two photos of a pair: the usual fix when order or names guessed wrong. */
export const swapSides = (pair) => ({ front: pair.back, back: pair.front });
