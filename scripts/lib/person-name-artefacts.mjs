/**
 * Which candidate names are not people, decided in one place.
 *
 * WHY THIS IS SHARED
 *
 * Three things need this answer and must not disagree about it: buildPersons, which
 * should not mint a person from a name that is not one; the review audit, which reports
 * what is left; and anything later that walks the persons index. The same rule written
 * out twice is how "how many maps" once produced three different answers in this repo.
 *
 * WHAT IT CATCHES
 *
 * Something upstream of Civgraph split a "Name, Party" string in the wrong place and put
 * the TAIL OF THE PARTY into the candidate name field, in the Northern Ireland local
 * government bundles for 2014, 2019 and 2023:
 *
 *     name="Party"    party="SDLP"        <- ...Social Democratic and Labour PARTY
 *     name="Voice"    party="TUV"         <- Traditional Unionist VOICE
 *     name="Ireland"  party="Alliance"    <- Alliance Party of Northern IRELAND
 *     name="Féin"     party="Sinn Féin"   <- Sinn FÉIN
 *
 * The defect is in the vendored source, not in this repo's ingest: the source rows carry
 * `"Firstname": ""` with the fragment already sitting in `Surname`, so the real name is
 * absent rather than mangled. It is not recoverable from anything held locally. These
 * candidacies are therefore real results with an unknown candidate, which is why the
 * candidate rows are left alone and only the PERSON is suppressed. Deleting the rows
 * would discard genuine votes, several of them winning ones.
 *
 * scripts/validate-candidate-name-party.mjs guards the candidate rows themselves and
 * stops new fragments appearing. This governs the separate question of whether a name
 * earns an entry in the persons index.
 *
 * WHY THE RULE IS SHAPED THIS WAY
 *
 * A name is only a fragment if it is a SINGLE WORD and that word belongs to a MULTI-WORD
 * party name. Both halves are load-bearing, and the reason is Denis Ireland, a real
 * Northern Ireland senator, alongside Boyd Ireland. A rule matching any name CONTAINING
 * a party word deletes them both. A rule rejecting single-word names deletes the bare
 * surnames that are common in older sources. Measured against the current index, the
 * rule matches four distinct names: Party, Ireland, Voice and Féin.
 *
 * Two kinds are deliberately NOT treated as non-people, because they are real entities
 * with unresolved modelling questions rather than junk:
 *
 *   candidate-list          "Independent (Alan Chambers) list" stood in real elections.
 *                           It wants an entity type of its own, not deletion.
 *   wikipedia-disambiguator "Frederick Thompson (Northern Irish politician)" IS a person.
 *                           The qualifier exists because more than one of him does, so
 *                           stripping it needs a collision check first.
 *
 * See docs/review/PERSON-NAME-ARTEFACTS.md.
 */

/** Rules whose subjects are not people and must not enter the persons index. */
export const NOT_A_PERSON = new Set([
  'party-name-fragment',
  'bare-disambiguator',
  'name-is-a-party',
]);

/** Rules whose subjects are real entities that still need a modelling decision. */
export const NEEDS_DECISION = new Set([
  'candidate-list',
  'wikipedia-disambiguator',
]);

export const RULE_NOTES = {
  'party-name-fragment': 'a single word that is part of a multi-word party name',
  'bare-disambiguator': 'the whole name is a parenthesised qualifier',
  'name-is-a-party': 'the name is exactly a known party name',
  'candidate-list': 'this is a list name, not a person',
  'wikipedia-disambiguator': 'a real person whose name kept a Wikipedia qualifier',
};

/**
 * Party vocabulary, derived from the data rather than a hardcoded list that would rot.
 *
 * `records` is anything iterable of party-shaped objects; title, canonicalName and
 * observedNames are all read where present.
 */
export function buildPartyVocabulary(records) {
  const partyNames = new Set();
  for (const party of records || []) {
    const values = [party?.title, party?.canonicalName, party?.name, ...(party?.observedNames || [])];
    for (const value of values) {
      if (value) partyNames.add(String(value).toLowerCase().trim());
    }
  }
  // Only words of MULTI-word party names, and only longer ones: a short token like "of"
  // or "na" would match far too much, and a single-word party name is handled by the
  // exact-match rule instead.
  const partyWords = new Set();
  for (const name of partyNames) {
    const words = name.split(/\s+/);
    if (words.length > 1) for (const word of words) if (word.length > 3) partyWords.add(word);
  }
  return { partyNames, partyWords };
}

/**
 * Returns the rule a name breaks, or null when it looks like a person.
 * Order matters: the exact-party check runs before the fragment check so a single-word
 * party name is reported as what it is.
 */
export function classifyPersonName(rawName, vocabulary) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const lower = name.toLowerCase();
  const partyNames = vocabulary?.partyNames || new Set();
  const partyWords = vocabulary?.partyWords || new Set();

  if (partyNames.has(lower)) return 'name-is-a-party';
  if (!name.includes(' ') && partyWords.has(lower)) return 'party-name-fragment';
  if (/^\(.*\)$/.test(name)) return 'bare-disambiguator';
  if (/\(.*\)/.test(name) && /\blist\b/i.test(name)) return 'candidate-list';
  if (/\((politician|Northern Irish politician|Northern Ireland politician)\)/i.test(name)) {
    return 'wikipedia-disambiguator';
  }
  return null;
}

/** True when the name must not become an entry in the persons index. */
export function isNotAPerson(rawName, vocabulary) {
  return NOT_A_PERSON.has(classifyPersonName(rawName, vocabulary));
}
