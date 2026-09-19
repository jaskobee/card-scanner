// Where things sit on a card. See docs/architecture.md.
//
// Reading a whole card as one page hands Tesseract artwork, holograms, attack
// text and a ten-pixel collector number all at once, and it reads none of them
// well. The two things that identify a card sit in predictable strips, so each
// strip is cropped, cleaned up and read on its own.
//
// Everything is a fraction of the upright card, so one table serves a 600px
// scan and a 4000px photograph.

/** Width over height of a standard trading card, 63 x 88 mm. */
export const CARD_ASPECT = 63 / 88;

export const REGIONS = {
  // Name and HP run along the top. Older cards put "Evolves from ..." just above
  // the name, so the band starts near the edge and takes the full width.
  top: { x: 0.02, y: 0.012, w: 0.96, h: 0.13 },

  // The collector number sits bottom-left on recent cards and bottom-right on
  // older ones, beside the illustrator, copyright and rarity mark. Two tight
  // corners read far better than one wide strip: the strip also takes in the
  // weakness and retreat row, and the number drowns in it.
  bottomLeft: { x: 0.0, y: 0.90, w: 0.42, h: 0.10 },
  bottomRight: { x: 0.55, y: 0.90, w: 0.45, h: 0.10 },
};

/**
 * A region in pixels for a card of the given size, clamped to the card. Takes a
 * name from REGIONS or an explicit { x, y, w, h } in card fractions.
 */
export function regionRect(region, width, height) {
  const r = typeof region === 'string' ? REGIONS[region] : region;
  if (!r) throw new Error(`Unknown card region: ${region}`);
  const sx = Math.max(0, Math.round(r.x * width));
  const sy = Math.max(0, Math.round(r.y * height));
  const sw = Math.min(width - sx, Math.round(r.w * width));
  const sh = Math.min(height - sy, Math.round(r.h * height));
  return { sx, sy, sw, sh };
}
