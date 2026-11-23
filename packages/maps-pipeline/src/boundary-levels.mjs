/**
 * The boundary level of a map layer: country, province, county, district, ward, townland or
 * small-area, or 'other' for thematic layers (habitats, zoning, settlements) whose labels name a
 * class, not an area. The rules are the styling plan's registry (OT22, PLAN.md section 2.1,
 * D:/civgraph-intake/batch4-2026-11-11/styling-plan/tools/classify.mjs), applied to the layer id
 * without its -vector/-alias suffix, then to its category. Pure.
 *
 * Used by the label-point build (tiles/label-points.mjs): only boundary levels get label points.
 */

/** @typedef {'country' | 'province' | 'county' | 'district' | 'ward' | 'townland' | 'small-area' | 'other'} BoundaryLevel */

/** Ordered rules: the first whose pattern matches the bare id decides. @type {ReadonlyArray<[BoundaryLevel, RegExp]>} */
const RULES = Object.freeze([
  ['country', /^(ni-1921|roi-1938|ireland-island|osni-ni-outline)$/],
  ['province', /^(provinces|tailte-province-)/],
  ['province', /^mep-/],
  ['province', /^(nuts-[23]|tailte-nuts[23])/],
  ['province', /^(elb-|hsct-|ni-health-trust|roi-garda-regions|catholic-dioceses)/],
  ['province', /^(ttwa-)/],
  ['county', /^(counties-|roi-counties-|counties-ni-|administrative-counties-|counties-county-boroughs-)/],
  ['county', /^(local-authorities-|dublin-electoral-counties-|dlr-administrative-area)/],
  ['district', /^(pc-|bcn|bcni|osni-open-data-50k-boundaries-parliamentary|oda-map-00101-dail)/],
  ['district', /^dail-/],
  ['district', /^(stormont-|assembly-areas-|forum-|constitutional-convention-|ni-parliament)/],
  ['district', /^(lgd-|osni-open-data-(50k|largescale)-boundaries-local-government-districts|roi-municipal-districts-|oda-map-00639-municipal-district)/],
  ['district', /^(admin-areas-|rural-urban-districts-|tia-towns-ni-)/],
  ['district', /^(plu-|superintendent-registrars-districts-)/],
  ['district', /^(baronies|roi-baronies)/],
  ['district', /^roi-garda-divisions/],
  ['ward', /^(deas-|mid-ulster-council-district-electoral-areas|osni-open-data-50k-boundaries-district-electoral-areas|roi-lea-|dlr-local-electoral-areas|oda-map-00153-local-election-areas|oda-map-00140-electoral-areas)/],
  ['ward', /^county-ed-/],
  ['ward', /^(wards-|mid-ulster-council-wards|osni-open-data-50k-boundaries-wards)/],
  ['ward', /^(ded-|deds-|eds-|electoral-divisions-|ed-boundaries|dcc-electoral-divisions|dlr-ed-boundaries|district-electoral-divisions-|oda-map-00343-galway-city-electoral-divisions|pobal-hp-)/],
  ['ward', /^dispensary-districts-/],
  ['ward', /^civil-parishes/],
  ['ward', /^(sdz-|soa-)/],
  ['ward', /^roi-garda-(districts|sub-districts)/],
  ['ward', /^oda-map-00(150|156|157|358)-/],
  ['townland', /townland/],
  ['small-area', /^(roi-small-areas-|sa-2011|oa-2001|dz-2021)/]
]);

/** The level of a category the rules above miss. @type {Readonly<Record<string, BoundaryLevel>>} */
const CATEGORY_LEVEL = Object.freeze({
  'Townlands': 'townland',
  'Civil Parishes': 'ward',
  'Baronies': 'district',
  'Counties': 'county',
  'Dáil Eireann Constituencies': 'district',
  'Parliamentary Constituencies': 'district',
  'Devolved Constituencies': 'district',
  'District Electoral Areas': 'ward',
  'European Regions': 'province',
  'Referendums': 'district'
});

/**
 * @param {{ id?: string | null, category?: string | null }} layer
 * @returns {BoundaryLevel}
 */
export function boundaryLevelOf(layer) {
  const id = String(layer?.id || '').replace(/-(vector|alias)$/, '');
  for (const [level, pattern] of RULES) if (pattern.test(id)) return level;
  const category = String(layer?.category || '');
  return Object.prototype.hasOwnProperty.call(CATEGORY_LEVEL, category) ? /** @type {BoundaryLevel} */ (CATEGORY_LEVEL[category]) : 'other';
}
