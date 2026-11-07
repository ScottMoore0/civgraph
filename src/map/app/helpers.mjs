/**
 * Pure helpers of the map app (app/src/app.js and src/map/app/*): HTML escaping, election entity keys
 * and the page= address parameter, byte and search-text formatting. No DOM, no app state.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

export function slugifyEntityKey(value) {
  return String(value || '')
    .split('|')[0]
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(party|candidate|person|name):/, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeEntityName(value) {
  return String(value || '')
    .split('|')[0]
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[''`]/g, '')
    .replace(/[-_/.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function electionBodyFromEntityKey(key) {
  const bodyKey = String(key || '').split('__')[0];
  if (!bodyKey) return '';
  if (bodyKey.startsWith('local-government')) return 'Local Government Districts';
  const bodies = new Map([
    ['dail-eireann', 'Dáil Éireann'],
    ['house-of-commons-of-the-united-kingdom', 'House of Commons of the United Kingdom'],
    ['northern-ireland-assembly', 'Northern Ireland Assembly'],
    ['northern-ireland-forum-for-political-dialogue', 'Northern Ireland Forum for Political Dialogue'],
    ['northern-ireland-constitutional-convention', 'Northern Ireland Constitutional Convention'],
    ['parliament-of-northern-ireland', 'Parliament of Northern Ireland'],
    ['european-parliament', 'European Parliament'],
    ['ireland-european', 'European Parliament (Ireland)'],
    ['ireland-president', 'President of Ireland'],
    ['president-of-ireland', 'President of Ireland'],
    ['ireland-referendum', 'Referendum (Ireland)'],
    ['ireland-local', 'Local Government (Ireland)']
  ]);
  return bodies.get(bodyKey) || bodyKey.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function electionTypeFromEntityKey(key, title = '') {
  const bodyKey = String(key || '').split('__')[0];
  const label = `${bodyKey} ${title || ''}`;
  if (bodyKey.startsWith('local-government') || bodyKey === 'ireland-local') return 'Local';
  if (bodyKey === 'house-of-commons-of-the-united-kingdom') return 'Westminster';
  if (bodyKey === 'dail-eireann') return 'Dáil';
  if (bodyKey === 'northern-ireland-assembly') return 'Assembly';
  if (bodyKey === 'northern-ireland-forum-for-political-dialogue') return 'Forum';
  if (bodyKey === 'northern-ireland-constitutional-convention') return 'Convention';
  if (bodyKey === 'parliament-of-northern-ireland') return 'Parliament of NI';
  if (bodyKey === 'european-parliament' || bodyKey === 'ireland-european') return 'European';
  if (bodyKey === 'ireland-president' || bodyKey === 'president-of-ireland') return 'Presidential';
  if (/referendum/i.test(label)) return 'Referendum';
  // Belfast County Borough, Strabane Urban District and the like: councils, so local elections.
  if (/council|borough|urban-district|rural-district|corporation/i.test(bodyKey)) return 'Local';
  if (bodyKey === 'seanad-eireann') return 'Seanad';
  return bodyKey ? bodyKey.replace(/-/g, ' ') : 'Election';
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function shortCacheName(name) {
  return String(name || '')
    .replace(/^civgraph-test2-sw-v\d+-/, '')
    .replace(/^civgraph-/, '');
}

export function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The kinds of page the catalogue pane opens for an election entity; "person" is a candidate. */
export const ENTITY_TYPE_LABEL = Object.freeze({
  party: 'Party',
  candidate: 'Person',
  constituency: 'Constituency',
  dea: 'District Electoral Area',
  lgd: 'Council',
  feature: 'Feature'
});

export function canonicalEntityKind(kind) {
  const value = String(kind || '').toLowerCase();
  if (value === 'person' || value === 'candidate') return 'candidate';
  return ENTITY_TYPE_LABEL[value] && value !== 'feature' ? value : '';
}

/** How the address names a page: page=person:ian-paisley-48601, page=party:dup. */
export function pageParamOf(page) {
  if (!page?.kind || !page.key) return '';
  return `${page.kind === 'candidate' ? 'person' : page.kind}:${page.key}`;
}

export function parsePageParam(value) {
  const text = String(value || '');
  const at = text.indexOf(':');
  if (at <= 0) return null;
  const rawKind = text.slice(0, at);
  const key = text.slice(at + 1);
  if (!key) return null;
  if (rawKind === 'feature') return { kind: 'feature', key };
  const kind = canonicalEntityKind(rawKind);
  return kind ? { kind, key } : null;
}

/** A readable name for a page whose data has not arrived: the name part of a "Name|Party" key,
 * else the key, else for a bare person id, "Person 48601". */
export function entityKeyLabel(kind, key) {
  const text = String(key || '').split('|')[0].trim();
  if (kind === 'candidate' && /^\d+$/.test(text)) return `Person ${text}`;
  if (kind === 'candidate' && /-\d+$/.test(text)) {
    return text.replace(/-\d+$/, '').split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
  return text;
}

/** Where to look for a page in Browse when it cannot be opened here: a search of its section. */
export function entityBrowseSearchUrl(kind, label) {
  const section = kind === 'party' ? 'parties' : kind === 'candidate' ? 'persons' : 'features';
  return `/browse/#/${section}?q=${encodeURIComponent(String(label || '').split('|')[0].trim())}`;
}

/** fn over items, at most `limit` at a time, results in the items' order. */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
