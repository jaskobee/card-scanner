// Selection helpers for the cards table. Pure, so the fiddly parts — shift-click
// ranges, and keeping a selection honest when the view changes — are unit tested.

/** Ids from `fromId` to `toId` inclusive, in display order, whichever way round. */
export function rangeIds(orderedIds, fromId, toId) {
  const to = orderedIds.indexOf(toId);
  if (to < 0) return [];
  const from = orderedIds.indexOf(fromId);
  if (from < 0) return [toId];
  const [lo, hi] = from < to ? [from, to] : [to, from];
  return orderedIds.slice(lo, hi + 1);
}

/**
 * Keep only ids that are still visible. A bulk action must never reach a card
 * the user can no longer see, so a filter or search change narrows the selection.
 */
export function pruneSelection(selected, visibleIds) {
  const visible = new Set(visibleIds);
  return new Set([...selected].filter((id) => visible.has(id)));
}

/** How much of the shown rows is selected — drives the header checkbox. */
export function selectionState(selected, shownIds) {
  const count = shownIds.filter((id) => selected.has(id)).length;
  return {
    count,
    all: shownIds.length > 0 && count === shownIds.length,
    some: count > 0 && count < shownIds.length,
  };
}
