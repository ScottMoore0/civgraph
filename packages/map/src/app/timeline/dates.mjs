/**
 * Pure helpers of the timeline (packages/map/src/app/timeline/*): reading the dates of slider items and maps,
 * and the wording of boundary changes. No DOM, no app state; the methods of the same names on the
 * map app delegate here.
 */

/** A Date (UTC) from a timestamp, a year, an ISO date ("1950", "1950-06", "1950-06-02") or a
 * date string; null when there is none. */
export function parseTimelineDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    // A timestamp, not a year, whenever it is outside year range -- including the NEGATIVE
    // timestamps of every date before 1970. Testing only `> 9999` sent 1 Jan 1969
    // (-31536000000) to the text fallback, which parsed "01 Jan 1969" as local midnight:
    // 23:00 UTC on 31 Dec in Ireland, which kept summer time all year from 1968 to 1971.
    const date = Math.abs(numeric) > 9999 ? new Date(numeric) : new Date(Date.UTC(numeric, 0, 1));
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const isoMatch = String(value).trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2] || 1) - 1;
    const day = Number(isoMatch[3] || 1);
    const date = new Date(Date.UTC(year, month, day));
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * A map's year when its date is known only to the year: a bare year (2023), or 1 January of
 * it with nothing saying the day is meant (the 1977 DEDs are "1977-01-01"). A map named
 * "1 Jan 1919", or in force from that day, keeps its day. Null otherwise.
 */
export function yearOnlyMapDate(map) {
  const raw = String(map?.date ?? '').trim();
  if (/^\d{4}$/.test(raw)) return raw;
  if (!/^\d{4}-01-01$/.test(raw)) return null;
  if (/\b1 Jan(uary)?\b|-01-01\b/i.test(`${map.id || ''} ${map.name || ''}`) || map.dateEffective === raw) return null;
  return raw.slice(0, 4);
}

/** An area's name in a change description: as given, or title case when the source wrote it in
 * capitals. */
export function timelineChangeName(name) {
  const text = String(name || '').trim();
  if (!text) return 'an unnamed area';
  // "CROSSGAR and KILLYLEAGH" counts as capitals too: the joining words were left small.
  const bare = text.replace(/\b(and|of|the)\b/g, '');
  if (bare !== bare.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase()
    .replace(/(^|[\s\-(/.])([a-z])/g, (_match, lead, letter) => lead + letter.toUpperCase())
    .replace(/\s(And|Of|The|Na|An)\s/g, (match) => match.toLowerCase());
}

/** An area in hectares: whole numbers from 10 ha (grouped from 100), one decimal below. */
export function formatHectares(value) {
  const ha = Number(value) || 0;
  if (ha >= 100) return `${Math.round(ha).toLocaleString('en-GB')} ha`;
  if (ha >= 10) return `${Math.round(ha)} ha`;
  return `${ha.toFixed(1)} ha`;
}
