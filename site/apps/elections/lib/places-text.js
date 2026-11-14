/**
 * The words of the area pages, the search, the person page and the contest arrows (el-places,
 * 14 Nov 2026), each keyed for translation in data/i18n/strings/elections.txt (R10: the language
 * runtime translates a text node by its wording, so a sentence is one node). A pattern's {name}
 * parts are filled by fill(). Pure; tests/unit/elections-app-places.test.mjs holds every one to a
 * key of site/assets/i18n/en.json.
 */

export const TEXT = Object.freeze({
  // search (home)
  searchLabel: 'Search elections, places, people and parties',
  searchPlaceholder: 'e.g. Strangford, Naomi Long, Sinn Féin, 1946',
  searchPlaces: 'Places',
  searchPeople: 'People',
  searchParties: 'Parties',
  searchElections: 'Elections',
  searchNone: 'Nothing found.',
  searchFound: '{n} found',
  searchLoading: 'Searching…',
  searchPeopleFailed: 'People could not be searched just now.',
  // area page
  areaCrumb: 'Places',
  areaIdentity: 'Contests are gathered here by their name. A name is not a fixed area: different bodies can use the same name for different places, and boundaries are redrawn. Each body below is its own series.',
  areaNoMaps: 'No boundary map is held for these contests, so Civgraph cannot say whether the area changed between them.',
  areaBodies: 'Bodies',
  areaTrend: 'Share of the vote',
  areaTrendNote: 'General elections with every candidate\'s votes recorded. By-elections, unopposed returns and contests with missing votes are left out.',
  areaMembers: 'Members',
  areaMembersNew: 'new',
  areaContests: 'Every contest',
  areaBoundaries: 'Boundaries',
  areaOnMap: 'on the map',
  areaNoChart: 'Fewer than two contests here have every candidate\'s votes, so no trend is drawn.',
  colElection: 'Election',
  colKind: 'Kind',
  colSeats: 'Seats',
  colTurnout: 'Turnout',
  colResult: 'Result',
  colSeat: 'Seat {n}',
  byElection: 'by-election',
  general: 'general',
  byElectionWinner: 'By-election',
  otherBodies: 'This name in other bodies',
  allContestsHere: 'Every contest in {name}',
  // verdicts
  hold: '{party} hold',
  gain: '{party} gain from {previous}',
  win: '{party} win',
  winNewBoundaries: '{party} win, on new boundaries',
  winFirst: '{party} win, the first contest here on record',
  majority: 'majority {n}',
  unopposedOne: '{name} ({party}) returned unopposed',
  unopposedMany: '{n} members returned unopposed: {parties}',
  noChange: 'no change',
  noneElected: 'No member is recorded as elected.',
  newBoundaries: 'new boundaries',
  independent: 'Independent',
  // boundaries
  boundaryFirst: 'drawn on the map {map}',
  boundaryChanged: 'from this election drawn on the map {map} (before: {previous})',
  // contest arrows
  previousHere: 'Previous contest here',
  nextHere: 'Next contest here',
  // person page
  personCrumb: 'People',
  personCareer: 'Every candidacy',
  personRelatives: 'Relatives',
  personNamesakes: 'Same name, different person',
  personNamesakesNote: 'Civgraph holds these as separate people who share this name.',
  personBrowse: 'Full record in Browse',
  personSummary: '{stood} candidacies, {elected} elected, {years}',
  colBody: 'Body',
  colContest: 'Contest',
  colParty: 'Party',
  colVotes: 'Votes',
  colShare: 'Share',
  colOutcome: 'Outcome',
  elected: 'Elected',
  notElected: 'Not elected',
  returnedUnopposed: 'Returned unopposed',
});

/** A pattern with its {name} parts filled: the app's one filler (lib/chart-data.js). */
export { fill } from './chart-data.js';
