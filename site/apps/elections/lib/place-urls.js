/**
 * The app's URLs of an area page and a person page (el-places, 14 Nov 2026; routes in
 * lib/route.js), and a person's and a party's Browse pages. Pure.
 *
 *   /elections/area/<contest slug>/[?body=<body slug>]   every contest held under that name
 *   /elections/person/<person slug or id>/               a person's candidacies across bodies
 */
import { personRecordKey } from '../../../pkg/core/src/format.js';

/** An area page, optionally narrowed to one body. @param {string} slug @param {string | null} [bodySlug] */
export function areaUrl(slug, bodySlug = null) {
  return `/elections/area/${encodeURIComponent(slug)}/${bodySlug ? `?body=${encodeURIComponent(bodySlug)}` : ''}`;
}

/**
 * A person's page in the app, from a candidacy or a person record (their slug, else their id), or
 * null for a candidacy with no person.
 * @param {{ personSlug?: unknown, personId?: unknown }} person
 */
export function personAppUrl(person) {
  const key = personRecordKey({ personSlug: person.personSlug, personId: person.personId });
  return key ? `/elections/person/${encodeURIComponent(key)}/` : null;
}

/** A party's Browse page. @param {string} slug */
export const partyBrowseUrl = (slug) => `/browse/parties/${encodeURIComponent(slug)}`;

/** A person's Browse page. @param {string} slug */
export const personBrowseUrl = (slug) => `/browse/persons/${encodeURIComponent(slug)}`;

/** A boundary map's layer in the map app. @param {string} layerId */
export const layerMapUrl = (layerId) => `/maps/#layers=${encodeURIComponent(layerId)}`;
