/**
 * Whether two written names can be the same person, as far as the letters show.
 *
 * The JavaScript twin of names_compatible() in scripts/harvest_ei_candidate_ids.py, and
 * it must stay in step with it. Same surname, and forenames that agree as far as both go,
 * where an initial agrees with any name it begins; titles are ignored and name particles
 * are kept out of the forenames. So "General Richard Mulcahy" is Richard Mulcahy and
 * "P. J. Ruttledge" is Patrick J Ruttledge, but "Edmund Wall" is not Edward Wall and
 * "Eugene Doherty" is not Joseph O'Doherty.
 *
 * Callers use it only inside one contest's page, and only when the hit is unique.
 */
const TITLES = new Set([
  'general', 'gen', 'sir', 'major', 'maj', 'captain', 'capt', 'dr', 'doctor', 'countess',
  'count', 'lady', 'lord', 'colonel', 'col', 'lt', 'lieutenant', 'commandant', 'comdt',
  'professor', 'prof', 'rev', 'reverend', 'fr', 'father', 'mrs', 'mr', 'ms', 'miss',
  'senator', 'sen', 'cllr', 'councillor', 'alderman', 'ald', 'the', 'hon', 'dame', 'madame'
]);
const PARTICLES = new Set(['o', 'de', 'di', 'da', 'van', 'von', 'mac', 'mc', 'ni', 'ui', 'la', 'le']);

function tokens(value) {
  // Fold accents without a regex escape: drop the combining marks NFKD separates out.
  const folded = [...String(value || '').normalize('NFKD')]
    .filter((ch) => { const code = ch.charCodeAt(0); return code < 0x300 || code > 0x36f; })
    .join('')
    .toLowerCase();
  return folded.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t && !TITLES.has(t));
}

export function namesCompatible(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length || ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const fa = ta.slice(0, -1).filter((t) => !PARTICLES.has(t));
  const fb = tb.slice(0, -1).filter((t) => !PARTICLES.has(t));
  if (!fa.length || !fb.length) return false;
  for (let i = 0; i < Math.min(fa.length, fb.length); i += 1) {
    const x = fa[i];
    const y = fb[i];
    if (!(x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y)))) return false;
  }
  return true;
}
