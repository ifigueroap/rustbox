/**
 * Pure reorder math for the sidebar service list and the workspace rail.
 *
 * Both lists send the backend a full permutation of every id (services.rs
 * `reorder` and `reorder_workspaces` reject anything shorter). The sidebar
 * can show a filtered subset of services (the active workspace), so a drop
 * or a "move" computed from the visible rows still has to produce a full
 * list: ids outside the visible set keep their relative order, and only the
 * moved id's position among them changes.
 */

/** Drop `draggedId` next to `targetId` in `fullIds`. `placeAfter` chooses
 * which side of the target it lands on; both keep every other id's relative
 * order, including ids that are not part of the visible/filtered set that
 * produced `targetId`. Returns `fullIds` unchanged (a copy) if either id is
 * missing or they are the same id. */
export function reorderByDrop(
  fullIds: readonly string[],
  draggedId: string,
  targetId: string,
  placeAfter = false,
): string[] {
  if (draggedId === targetId || !fullIds.includes(draggedId) || !fullIds.includes(targetId)) {
    return fullIds.slice();
  }
  const ids = fullIds.filter((id) => id !== draggedId);
  const index = ids.indexOf(targetId) + (placeAfter ? 1 : 0);
  ids.splice(index, 0, draggedId);
  return ids;
}

/** Move `id` one step up or down among `visibleIds` (a subset of `fullIds`
 * in the same relative order, such as the active workspace's services), and
 * return the resulting full permutation. A no-op copy of `fullIds` comes
 * back at either end of `visibleIds` or when `id` is not in it. */
export function moveAdjacent(
  fullIds: readonly string[],
  visibleIds: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const position = visibleIds.indexOf(id);
  if (position === -1) return fullIds.slice();
  const targetPosition = position + direction;
  if (targetPosition < 0 || targetPosition >= visibleIds.length) return fullIds.slice();
  return reorderByDrop(fullIds, id, visibleIds[targetPosition], direction > 0);
}
