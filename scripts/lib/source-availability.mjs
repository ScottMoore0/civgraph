/**
 * A source record whose source has gone from its publisher is kept, not deleted, and says so.
 *
 * An approved-publication record (data/database/approved-publication-sources-shards/) marks it
 * with availability { status: 'removed-from-source', seenMissing: 'YYYY-MM-DD' }: the date a crawl
 * of the publisher's listing first found it missing. The Browse source record shows that the way
 * it shows a raw source's state: a status chip (the record page's badge) and the Status line.
 */

export const REMOVED_FROM_SOURCE = 'removed-from-source';
export const REMOVED_FROM_SOURCE_CHIP = "No longer on the publisher's website";

/**
 * @typedef {{ chip: string, status: string }} AvailabilityDisplay
 */

/**
 * The status chip and the Status line for a record's availability, or null when it has none
 * (or one this module does not know).
 * @param {unknown} availability  the record's availability field
 * @returns {AvailabilityDisplay | null}
 */
export function sourceAvailabilityDisplay(availability) {
  if (!availability || typeof availability !== 'object') return null;
  const { status, seenMissing } = /** @type {{ status?: unknown, seenMissing?: unknown }} */ (availability);
  if (status !== REMOVED_FROM_SOURCE) return null;
  const seen = typeof seenMissing === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(seenMissing) ? seenMissing : '';
  return {
    chip: REMOVED_FROM_SOURCE_CHIP,
    status: seen ? `${REMOVED_FROM_SOURCE_CHIP} (found missing on ${seen})` : REMOVED_FROM_SOURCE_CHIP,
  };
}
