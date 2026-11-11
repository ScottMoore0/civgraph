/**
 * Party, person, constituency and council pages opened from the election pane into the catalogue pane,
 * built from the Browse records (/data/browse/, answered from D1).
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import {
  canonicalEntityKind,
  electionBodyFromEntityKey,
  electionTypeFromEntityKey,
  ENTITY_TYPE_LABEL,
  entityBrowseSearchUrl,
  entityKeyLabel,
  mapWithConcurrency,
  normalizeEntityName,
  slugifyEntityKey
} from './helpers.mjs';
import uiController from '../../../../src/ui-controller.js';
import { partyFullName } from '../../../core/src/party-names.mjs';
import { ENTITY_PAGE_LOAD } from '../../../../src/ui-state-machines.mjs';
import { createState } from '../state-helpers.mjs';
import {
  addPartyChanges,
  addStandings,
  BODY_GROUP_ORDER,
  bodyGroupOf,
  groupConstituencies,
  isListPseudoCandidate,
  knownCount,
  leadingPartyOf,
  normaliseStatus,
  partyHeadlineCards
} from '../../../../src/entity-detail-data.mjs';

export class EntityBridgeMethods {
  /**
   * Open a party, person or constituency page in the catalogue pane.
   *
   * UX review 2026-10-31 (H4, H6). The page used to appear only once its data had arrived (a
   * constituency took 6.9 s, with nothing on screen meanwhile), vanished without a word when the
   * lookup missed, and had no address: a reload or a shared link lost it, and browser Back undid
   * the map behind it while the pane stayed put. Now the page shell and its name show at once,
   * the step is a history entry with the page in the address (page=party:dup), a miss or a
   * failure says so with a Retry, and Back returns to the page before.
   *
   * options.fromHistory: reopening from the address (Back, Forward, a reload or a shared link),
   * so no new history entry is made and the page keeps its scroll and table state.
   */
  async openElectionEntityDetailInCatalogue(kind, key, options = {}) {
    const pageKind = canonicalEntityKind(kind);
    const keyText = String(key ?? '').trim();
    if (!pageKind || !keyText) return false;
    const token = (this.entityPageToken = (this.entityPageToken || 0) + 1);
    // This opening's state: loading, then loaded, choice, error or missing (MA-10).
    const load = createState(ENTITY_PAGE_LOAD);
    const label = options.label || entityKeyLabel(pageKind, keyText);
    const typeLabel = ENTITY_TYPE_LABEL[pageKind] || 'Page';
    const requested = { kind: pageKind, key: keyText, title: label, typeLabel };
    if (!options.fromHistory) this.beginNavigation(`${typeLabel}: ${label}`);
    this.currentPage = requested;
    this.currentDetailMapId = null;
    this.revealCatalogueOnPhone();
    uiController.showElectionEntityPlaceholder?.({ kind: pageKind, key: keyText, label, typeLabel, state: load.state() }, { addToHistory: !options.fromHistory });
    this.endNavigation();

    let detail = null;
    let failure = null;
    try {
      detail = await this.loadElectionEntityBrowseDetail(pageKind, keyText);
    } catch (error) {
      failure = error;
    }
    // The reader has moved on (another page, the list, Back) while this one loaded: it must not
    // replace what they are now looking at.
    if (token !== this.entityPageToken || this.currentPage !== requested) return true;

    if (!detail || detail.kind === 'candidate-choice') {
      if (failure) console.warn('[Test2] Catalogue page could not be loaded', pageKind, keyText, failure);
      uiController.showElectionEntityPlaceholder?.({
        kind: pageKind,
        key: keyText,
        label,
        typeLabel,
        state: load.to(detail ? 'choice' : (failure ? 'error' : 'missing')),
        choices: detail?.choices || [],
        browseUrl: entityBrowseSearchUrl(pageKind, label),
        retry: () => this.openElectionEntityDetailInCatalogue(pageKind, keyText, { ...options, fromHistory: true })
      }, { addToHistory: false });
      this.announce(detail ? `More than one person is called ${label}: choose one.` : `${label} could not be ${failure ? 'loaded' : 'found'}.`);
      return true;
    }

    // Cached under the key it was asked for as well as its own, so the pane's history and the
    // address can name it either way.
    load.to('loaded');
    uiController._electionEntityDetailCache?.set(uiController.createElectionEntityDetailId(pageKind, keyText), detail);
    uiController.showElectionEntityDetailInCatalogue(detail, false, {
      restoreState: Boolean(options.fromHistory),
      focus: options.focus !== false
    });
    // The address names the page by its canonical key (the party's slug, the person's), so a
    // copied link reads the same whichever spelling opened it.
    this.currentPage = { kind: pageKind, key: detail.key || keyText, title: detail.name || label, typeLabel };
    this.updateURLState();
    return true;
  }

  async loadElectionEntityBrowseDetail(kind, key) {
    const normalizedKind = canonicalEntityKind(kind);
    const cacheKey = `${normalizedKind}:${key || ''}`;
    if (this.browseEntityDetailCache.has(cacheKey)) return this.browseEntityDetailCache.get(cacheKey);
    let detail = null;
    if (normalizedKind === 'party') {
      detail = await this.loadPartyBrowseDetail(key);
    } else if (normalizedKind === 'candidate') {
      detail = await this.loadPersonBrowseDetail(key);
    } else if (['constituency', 'dea', 'lgd'].includes(normalizedKind)) {
      detail = await this.loadAreaBrowseDetail(normalizedKind, key);
    }
    // A chooser is not cached: the reader's choice opens the person by id.
    if (detail && detail.kind !== 'candidate-choice') this.browseEntityDetailCache.set(cacheKey, detail);
    return detail;
  }

  /**
   * The party registry as Browse lists it (/_api/parties, from D1; was /data/browse/parties.json): every party with its
   * full name, short name, aliases and colour, keyed by each spelling. A results table names a
   * party as the ballot did ("Ulster Unionist", "Official Unionist"), and only the registry
   * knows that both are the UUP; a spelling two records share goes to the one with more
   * linked elections, the party rather than a ballot-paper label.
   */
  async loadPartyIndex() {
    if (!this.partyIndexPromise) {
      this.partyIndexPromise = fetch('/_api/parties', { cache: 'default' })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`parties index ${response.status}`))))
        .then((payload) => {
          const items = Array.isArray(payload?.items) ? payload.items : [];
          const byAlias = new Map();
          const ranked = [...items].sort((a, b) => (Number(b.relatedElectionCount) || 0) - (Number(a.relatedElectionCount) || 0));
          for (const item of ranked) {
            for (const name of [item.slug, item.title, item.shortName, item.canonicalName, ...(item.knownAliases || []), ...(item.observedNames || [])]) {
              const k = normalizeEntityName(name);
              if (k && !byAlias.has(k)) byAlias.set(k, item);
            }
          }
          return { items, byAlias };
        })
        .catch((error) => {
          this.partyIndexPromise = null;
          console.warn('[Test2] Party index unavailable', error);
          return { items: [], byAlias: new Map() };
        });
    }
    return this.partyIndexPromise;
  }

  partyFromIndex(index, name) {
    if (!index?.byAlias || !name) return null;
    return index.byAlias.get(normalizeEntityName(name))
      || index.byAlias.get(normalizeEntityName(partyFullName(name)))
      || null;
  }

  partyColourFrom(index, name) {
    const hit = this.partyFromIndex(index, name);
    const colour = hit?.colour;
    return colour && colour !== '#6b7280' ? colour : '#888';
  }

  async loadPartyBrowseDetail(key) {
    const index = await this.loadPartyIndex();
    const hit = this.partyFromIndex(index, key);
    const slug = slugifyEntityKey(key);
    const candidates = [...new Set([hit?.slug, slug, String(key || '').trim().toLowerCase()].filter(Boolean))];
    let failure = null;
    for (const candidateSlug of candidates) {
      let response;
      try {
        response = await fetch(`/_api/parties?slug=${encodeURIComponent(candidateSlug)}`, { cache: 'default' });
      } catch (error) {
        failure = error;
        continue;
      }
      if (response.status === 404) continue;
      if (!response.ok) { failure = new Error(`party ${candidateSlug}: ${response.status}`); continue; }
      const detail = await response.json();
      const item = detail.item || detail;
      const persons = await this.loadPartyPersons(item);
      return this.mapPartyBrowseItem(item, persons, index);
    }
    // Nothing found and something failed on the way: that is "could not load", not "no such party".
    if (failure) throw failure;
    return null;
  }

  /**
   * One person, by key. Served from D1 (/_api/persons?slug=), not from the shards.
   *
   * The key is the person's id or slug wherever the link knows it -- a results table's
   * candidate button carries the source person id (UX review 2026-10-31, H5). A bare name was
   * the old key, and opened whoever held the bare-name slug: the Alliance Ian Paisley of
   * Holywood got the DUP leader's page. A name, with the party and date where known
   * ("Name|Party|date"), is now searched for, narrowed to the people who stood for that party
   * then, and answered with a chooser if more than one remains.
   *
   * The endpoint 404s honestly on a miss, which the shard walk could not do. The static shards
   * remain the fallback when the endpoint itself is unavailable, so a Functions outage degrades
   * rather than breaks.
   */
  async loadPersonBrowseDetail(key) {
    const raw = String(key || '').trim();
    const [namePart = '', partyPart = '', datePart = ''] = raw.split('|').map((part) => part.trim());
    const isNameKey = raw.includes('|');
    const partyIndex = await this.loadPartyIndex();
    let endpointDown = false;

    const fetchOne = async (slug) => {
      const response = await fetch(`/_api/persons?slug=${encodeURIComponent(slug)}`, { cache: 'default' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`persons ${response.status}`);
      const payload = await response.json();
      return payload?.person || null;
    };

    if (!isNameKey) {
      const direct = raw.replace(/^(id|person|candidate|name):/i, '');
      try {
        const person = await fetchOne(direct) || (slugifyEntityKey(direct) !== direct ? await fetchOne(slugifyEntityKey(direct)) : null);
        if (person) return this.mapPersonBrowseItem(person, partyIndex);
      } catch {
        endpointDown = true;
      }
    }

    if (!endpointDown && namePart) {
      try {
        const response = await fetch(`/_api/persons?q=${encodeURIComponent(namePart)}&limit=50`, { cache: 'default' });
        if (!response.ok) throw new Error(`persons search ${response.status}`);
        const payload = await response.json();
        const wanted = normalizeEntityName(namePart);
        const sameName = (payload?.persons || []).filter((person) => [person.name, person.title, ...(person.names || []).map((n) => n.name)]
          .some((name) => normalizeEntityName(name) === wanted));
        const stoodFor = (person) => (person.elections || []).some((row) => (!partyPart || normalizeEntityName(row.party) === normalizeEntityName(partyPart)
          || this.partyFromIndex(partyIndex, row.party)?.slug === this.partyFromIndex(partyIndex, partyPart)?.slug)
          && (!datePart || row.date === datePart));
        // With a party (or date) to go on, a same-named person who never stood for it is a
        // namesake: no page is better than the wrong person's.
        const narrowed = sameName.filter(stoodFor);
        const pool = partyPart || datePart ? narrowed : sameName;
        if (pool.length === 1) return this.mapPersonBrowseItem(pool[0], partyIndex);
        if (pool.length > 1) {
          return {
            kind: 'candidate-choice',
            key: raw,
            name: namePart,
            choices: pool.map((person) => ({ key: person.slug || person.id, name: person.name || person.title, subtitle: person.subtitle || '' }))
          };
        }
      } catch {
        endpointDown = true;
      }
    }

    // /_api/persons is the only path (data design phase 2): the person shards it replaced are no
    // longer files. Its responses carry a last-good copy for when D1 is unavailable.
    if (endpointDown) console.warn('[persons] /_api/persons is unavailable');
    return null;
  }

  /**
   * The persons who stood for one party, for its candidate summaries.
   *
   * buildPartyCandidateSummaries() matches on a party's aliases -- canonical name, title,
   * observed names, known aliases -- so all of them are sent.
   *
   * The endpoint returns at most 200 a request, and the DUP, Sinn Féin and Fianna Fáil each
   * have more: the page said "Candidates (200)" as if that were the party's total (UX review
   * 2026-10-31, H2). It is asked page by page; if it does not page (a second page identical to
   * the first, as the party query did before it took an offset) the result is marked capped and
   * the page says the list is partial.
   */
  async loadPartyPersons(item = {}) {
    const aliases = [...new Set([
      item.canonicalName,
      item.title,
      item.shortName,
      ...(item.observedNames || []),
      ...(item.knownAliases || []),
    ].filter(Boolean))];
    if (!aliases.length) return { persons: [], capped: false };
    const PAGE = 200;
    const MAX_PAGES = 20;
    const persons = [];
    const seen = new Set();
    let capped = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams();
      for (const alias of aliases) params.append('party', alias);
      params.set('limit', String(PAGE));
      if (page) params.set('offset', String(page * PAGE));
      let payload = null;
      try {
        const response = await fetch(`/_api/persons?${params}`, { cache: 'default' });
        if (response.ok) payload = await response.json();
      } catch { /* handled below */ }
      if (!Array.isArray(payload?.persons)) {
        if (page === 0) return { persons: [], capped: true };
        capped = true;
        break;
      }
      const fresh = payload.persons.filter((person) => {
        const id = String(person.id || person.slug || '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      if (page > 0 && !fresh.length && payload.persons.length) { capped = true; break; }
      persons.push(...fresh);
      if (payload.persons.length < PAGE) break;
      if (Number.isFinite(Number(payload.total)) && persons.length >= Number(payload.total)) break;
      if (page === MAX_PAGES - 1) capped = true;
    }
    return { persons, capped };
  }

  async loadAreaBrowseDetail(kind, key) {
    const name = String(key || '').trim();
    if (!name) return null;
    const elections = await this.ensureElections();
    const catalogueEntries = Array.isArray(elections?.catalogue?.elections) ? elections.catalogue.elections : [];
    const target = normalizeEntityName(name);
    const entries = catalogueEntries.filter((entry) => {
      const candidateNames = kind === 'lgd'
        ? [...(entry.localBodies || []), entry.body]
        : (entry.constituencies || []);
      const mayContainTarget = candidateNames.some((candidate) => normalizeEntityName(candidate) === target);
      return mayContainTarget || (kind === 'constituency' && entry.key === this.elections?.activeEntry?.key);
    });
    // Four bundles at a time rather than one after another: a constituency contested in fifty
    // elections took 6.9 s to open (UX review 2026-10-31, H6).
    const perEntry = await mapWithConcurrency(entries, 4, async (entry) => {
      let bundle = null;
      try {
        bundle = await elections.loadBundle(entry);
      } catch {
        return [];
      }
      const matchingResults = (bundle?.results || []).filter((result) => {
        if (kind === 'lgd') {
          return normalizeEntityName(result.localBody || result.localGovernmentDistrict || result.council || result.bodyLabel || '') === target;
        }
        return normalizeEntityName(result.constituency || result.matchName || result.featureName || '') === target;
      });
      if (!matchingResults.length) return [];
      if (kind === 'lgd') return [this.mapCouncilAreaHistoryRow(entry, bundle, name, matchingResults)];
      return matchingResults.map((result) => this.mapConstituencyAreaHistoryRow(entry, bundle, result, kind));
    });
    // Oldest first, as Browse lists elections.
    const rows = perEntry.flat()
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.electionDisplayName || '').localeCompare(String(b.electionDisplayName || '')));
    if (!rows.length) return null;
    const general = rows.filter((row) => !row.isByElection);
    const latest = (general.length ? general : rows)[(general.length ? general : rows).length - 1];
    const latestElectedRow = [...rows].reverse().find((row) => row.electedNames?.length) || null;
    const metrics = {
      elections: rows.length,
      byElections: rows.length - general.length,
      districts: [...new Set(rows.map((row) => normalizeEntityName(row.localGovernmentDistrict)).filter(Boolean))].length,
      deas: kind === 'lgd'
        ? Math.max(0, ...rows.map((row) => Number(row.deaCount || 0)))
        : rows.length,
      firstYear: Number(String(rows[0]?.date || '').slice(0, 4)) || null,
      lastYear: Number(String(rows[rows.length - 1]?.date || '').slice(0, 4)) || null,
      latestDate: latest?.date || null,
      latestLeadingParty: latest?.winnerParty || '',
      latestElection: latestElectedRow?.electionDisplayName || '',
      latestElected: latestElectedRow?.electedNames || []
    };
    return {
      kind,
      key: name,
      name,
      colour: latest?.winnerColour || '#64748b',
      subtitle: kind === 'lgd' ? 'Local Government District / Council' : kind === 'dea' ? 'District Electoral Area' : 'Constituency',
      metrics,
      historyRows: rows,
      browseUrl: entityBrowseSearchUrl(kind, name)
    };
  }

  mapPartyBrowseItem(item, personsResult = {}, partyIndex = null) {
    const related = Array.isArray(item.relatedElections) ? item.relatedElections : [];
    // Oldest first, as Browse lists a party's elections, so the two pages read the same way.
    const historyRows = addPartyChanges(related.map((row) => this.mapPartyHistoryRow(row)))
      .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
    const persons = Array.isArray(personsResult) ? personsResult : (personsResult.persons || []);
    const { summaries, listEntries } = this.buildPartyCandidateSummaries(item, persons, partyIndex);
    const slug = item.slug || slugifyEntityKey(item.canonicalName || item.title);
    const shortName = item.shortName || (item.canonicalName && item.canonicalName !== item.title ? item.canonicalName : '');
    return {
      kind: 'party',
      key: slug,
      slug,
      // The full name heads the page and the abbreviation sits beneath it (UX review 2026-10-31,
      // L7: "AO" or "Ind O" in a results table meant nothing on a phone, where <abbr> cannot be read).
      name: item.title || item.canonicalName || slug,
      shortName,
      colour: item.colour || item.color || item.partyColour || '#6b7280',
      headlineCards: partyHeadlineCards(historyRows),
      historyRows,
      partySummaries: historyRows,
      candidateSummaries: summaries,
      // The persons endpoint returns at most 200 a page; when it cannot page further the list is
      // said to be partial rather than presented as the party's total (H2).
      candidatesCapped: Boolean(personsResult.capped),
      listEntriesLeftOut: listEntries,
      totals: item.totals || {},
      observedNames: item.observedNames || [],
      knownAliases: item.knownAliases || [],
      firstYear: item.firstYear,
      lastYear: item.lastYear,
      relatedElectionCount: related.length,
      browseUrl: `/browse/parties/${encodeURIComponent(slug)}`
    };
  }

  mapPersonBrowseItem(item, partyIndex = null) {
    const elections = Array.isArray(item.elections) ? item.elections : [];
    // Oldest first, numbered as they go (the 3rd time standing, the 2nd win), as Browse lists them.
    const appearances = addStandings(elections.map((row) => this.mapPersonAppearanceRow(row)));
    const latest = appearances[appearances.length - 1] || null;
    const latestParty = latest?.party || item.parties?.[0]?.name || '';
    const slug = item.slug || String(item.id || '') || slugifyEntityKey(item.name || item.title);
    const stood = knownCount(item.totals?.stood) ?? appearances.length;
    const won = knownCount(item.totals?.elected) ?? appearances.filter((row) => row.elected).length;
    const votesKnown = appearances.some((row) => row.firstPref !== null);
    return {
      kind: 'candidate',
      key: slug,
      slug,
      personId: item.id || '',
      name: item.name || item.title || '',
      latestParty,
      // The person record has no colour; their latest party's, rather than a grey swatch (M3).
      colour: this.partyColourFrom(partyIndex, latestParty),
      // Each party once: "Protestant Unionist" and "Protestant Unionist Party" are one party.
      parties: [...new Map((item.parties || []).map((party) => party.name || party).filter(Boolean)
        .map((name) => [this.partyFromIndex(partyIndex, name)?.slug || normalizeEntityName(partyFullName(name)), name])).values()],
      constituencyGroups: groupConstituencies(appearances),
      appearances,
      firstPrefs: votesKnown ? knownCount(item.totals?.firstPrefs, true) : null,
      electedCount: won,
      stoodCount: stood,
      firstYear: item.firstYear || null,
      lastYear: item.lastYear || null,
      born: item.born || null,
      died: item.died || null,
      lifeSource: [...new Set([item.bornSource, item.diedSource].filter(Boolean))].join(', '),
      officialProfiles: Array.isArray(item.officialProfiles) ? item.officialProfiles : [],
      browseUrl: `/browse/persons/${encodeURIComponent(slug)}`
    };
  }

  mapPartyHistoryRow(row = {}) {
    const body = electionBodyFromEntityKey(row.key) || row.body || '';
    const electionType = electionTypeFromEntityKey(row.key, row.title);
    const label = `${row.title || ''} ${row.key || ''}`;
    const elected = knownCount(row.seats ?? row.elected);
    // Browse's reading of the summary: a 0 beside seats won is a count it did not carry.
    const stood = knownCount(row.stood ?? row.candidates, Number(elected) > 0);
    const votes = knownCount(row.votes ?? row.firstPrefs, Number(elected) > 0 || Number(stood) > 0);
    const share = votes === null ? null : knownCount(row.share ?? row.validVotePct);
    const totalSeats = knownCount(row.totalSeats, true);
    return {
      electionDisplayName: row.title || row.key || '',
      electionBodyForOpen: body,
      body,
      bodyLabel: body,
      bodyGroup: bodyGroupOf(electionType),
      date: row.date || '',
      electionType,
      rank: knownCount(row.rank, true),
      contested: !/referendum|recall/i.test(label),
      isRecallPetition: /recall petition/i.test(label),
      isByElection: /by-election|bye-election/i.test(label),
      stood,
      elected,
      totalSeats,
      seatPct: totalSeats && elected !== null ? elected / totalSeats * 100 : null,
      constituenciesContested: knownCount(row.constituenciesContested ?? row.constituencies, true),
      firstPrefs: votes,
      validVotePct: share,
      // Filled by addPartyChanges().
      electedDelta: null,
      stoodDelta: null,
      firstPrefsDelta: null,
      validVotePctDelta: null
    };
  }

  mapPersonAppearanceRow(row = {}) {
    const body = electionBodyFromEntityKey(row.key);
    const electionType = electionTypeFromEntityKey(row.key, row.title);
    // A candidate with no votes at all does not happen; a 0 here is a vote the source did not
    // record (the 1996 Forum's lists), so it is shown as unknown.
    const firstPref = knownCount(row.firstPref ?? row.firstPrefs ?? row.votes, true);
    const status = normaliseStatus({ ...row, firstPref });
    return {
      electionKey: row.key || '',
      electionDisplayName: row.title || row.key || '',
      electionBodyForOpen: body,
      body,
      bodyLabel: electionType === 'Local' ? (row.localBody || row.bodyLabel || body) : body,
      bodyGroup: bodyGroupOf(electionType),
      date: row.date || '',
      constituency: row.constituency || '',
      party: row.party || '',
      status: status.label,
      statusSource: status.raw,
      rank: knownCount(row.rank, true),
      firstPref,
      firstPrefs: firstPref,
      firstPrefPct: knownCount(row.firstPrefPct ?? row.share),
      elected: status.elected,
      electionType,
      isByElection: /by-election|bye-election/i.test(`${row.title || ''} ${row.key || ''}`)
    };
  }

  /**
   * Everyone who stood for the party, with how often they stood and won and where. Labels such as
   * "DUP list" -- the 1996 Forum's regional lists -- are counted separately, not listed as people
   * (UX review 2026-10-31, H8).
   */
  buildPartyCandidateSummaries(item = {}, persons = [], partyIndex = null) {
    const aliases = new Set([
      item.canonicalName,
      item.title,
      item.shortName,
      ...(item.observedNames || []),
      ...(item.knownAliases || [])
    ].map(normalizeEntityName).filter(Boolean));
    const ownSlug = item.slug || '';
    const isOwnParty = (party) => {
      const key = normalizeEntityName(party);
      if (aliases.has(key)) return true;
      // A spelling the party record does not list but the registry files under it.
      return Boolean(ownSlug && partyIndex?.byAlias?.get(key)?.slug === ownSlug);
    };
    const summaries = new Map();
    let listEntries = 0;
    for (const person of persons || []) {
      const name = person.name || person.title || '';
      const rows = (person.elections || []).filter((row) => isOwnParty(row.party));
      if (!rows.length) continue;
      if (isListPseudoCandidate(name)) { listEntries += 1; continue; }
      const personId = person.slug || person.id || slugifyEntityKey(name);
      const appearances = rows.map((row) => this.mapPersonAppearanceRow(row));
      const byGroup = new Map();
      let votes = 0;
      let votesKnown = false;
      for (const row of appearances) {
        const group = byGroup.get(row.bodyGroup) || { stood: 0, won: 0 };
        group.stood += 1;
        if (row.elected) group.won += 1;
        byGroup.set(row.bodyGroup, group);
        if (row.firstPref !== null) { votes += row.firstPref; votesKnown = true; }
      }
      summaries.set(personId, {
        personId,
        name: name || personId,
        totalFirstPrefs: votesKnown ? votes : null,
        timesStood: appearances.length,
        timesElected: appearances.filter((row) => row.elected).length,
        byGroup: BODY_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({ group, ...byGroup.get(group) })),
        firstYear: Math.min(...appearances.map((row) => Number(String(row.date).slice(0, 4)) || 9999)),
        lastYear: Math.max(...appearances.map((row) => Number(String(row.date).slice(0, 4)) || 0)),
        constituencyGroups: groupConstituencies(appearances)
      });
    }
    const list = [...summaries.values()].sort((a, b) => (
      b.timesElected - a.timesElected
        || (b.totalFirstPrefs || 0) - (a.totalFirstPrefs || 0)
        || b.timesStood - a.timesStood
        || a.name.localeCompare(b.name)
    ));
    return { summaries: list, listEntries };
  }

  mapConstituencyAreaHistoryRow(entry, bundle, result, kind) {
    const lead = leadingPartyOf(result, { normalise: normalizeEntityName });
    const seats = knownCount(result.seatsTotal ?? result.seatsWon, true);
    return {
      electionKey: bundle.key || entry.key || '',
      electionDisplayName: bundle.displayTitle || entry.displayTitle || entry.title || entry.key || '',
      electionBodyForOpen: bundle.body || entry.body || '',
      body: bundle.body || entry.body || '',
      date: bundle.date || entry.date || '',
      constituency: result.constituency || '',
      localGovernmentDistrict: result.localBody || result.localGovernmentDistrict || '',
      // The party with the most votes, summed over its candidates (H3), not the poll-topper's.
      winnerParty: lead.party,
      winnerColour: lead.colour || '#b0bec5',
      winnerVotes: lead.votes,
      winnerPct: lead.pct,
      electedNames: lead.elected,
      validVotes: knownCount(lead.valid, true),
      seats,
      isByElection: /by-election|bye-election/i.test(`${bundle.displayTitle || entry.displayTitle || ''}`) || entry.kind === 'by-election',
      areaKind: kind
    };
  }

  mapCouncilAreaHistoryRow(entry, bundle, name, results) {
    const partyTotals = new Map();
    let validVotes = 0;
    let validKnown = false;
    let seats = 0;
    for (const result of results) {
      if (knownCount(result.validPoll, true) !== null) { validVotes += Number(result.validPoll); validKnown = true; }
      seats += Number(result.seatsTotal ?? result.seatsWon ?? 0) || 0;
      for (const candidate of result.candidates || []) {
        // A candidate with no label counts as "No label" (NO_LABEL), not as the leading party.
        const party = candidate.party || 'No label';
        const key = normalizeEntityName(party);
        const current = partyTotals.get(key) || { party, votes: 0, colour: candidate.colour || result.leadingColour || '#b0bec5' };
        current.votes += Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0;
        partyTotals.set(key, current);
      }
    }
    const leading = [...partyTotals.values()].sort((a, b) => b.votes - a.votes)[0] || {};
    return {
      electionKey: bundle.key || entry.key || '',
      electionDisplayName: bundle.displayTitle || entry.displayTitle || entry.title || entry.key || '',
      electionBodyForOpen: bundle.body || entry.body || '',
      body: bundle.body || entry.body || '',
      date: bundle.date || entry.date || '',
      deaCount: results.length,
      districtElectoralAreas: results.map((result) => result.constituency).filter(Boolean),
      winnerParty: leading.party || '',
      winnerColour: leading.colour || '#b0bec5',
      winnerVotes: leading.votes || null,
      winnerPct: validKnown && leading.votes ? leading.votes / validVotes * 100 : null,
      validVotes: validKnown ? validVotes : null,
      seats: seats || null,
      isByElection: /by-election|bye-election/i.test(`${bundle.displayTitle || entry.displayTitle || ''}`) || entry.kind === 'by-election',
      localGovernmentDistrict: name
    };
  }
}
