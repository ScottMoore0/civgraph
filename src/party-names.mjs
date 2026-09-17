/**
 * Party abbreviations for results tables: the table shows the abbreviation, and the full
 * name appears on hover (<abbr title>).
 *
 * The election data spells parties many ways -- "DUP" beside "Sinn Féin", "Alliance" beside
 * "Alliance Party", "Fianna Fail" beside "Fianna Fáil", ballot-paper "... Lozenge" artefacts,
 * "Independent (Alan Chambers)" -- so every spelling found in
 * data/elections-source/data/elections is listed against one abbreviation and one full name.
 * A party with no entry is shown as it is spelled in the data.
 */

// [abbreviation, full name, ...other spellings in the data]
const PARTIES = [
  ['DUP', 'Democratic Unionist Party', 'DUP Civil Servant (Retired)'],
  ['UUP', 'Ulster Unionist Party', 'Ulster Unionist', 'Official Unionist Party', 'Official Unionist',
    'Shopkeeper, Ulster Unionist', 'Businssman Ulster Unionist'],
  ['AP', 'Alliance Party', 'Alliance', 'Alliance Party of Northern Ireland'],
  ['SDLP', 'Social Democratic and Labour Party'],
  ['SF', 'Sinn Féin', 'Sinn Fein'],
  ['Ind U', 'Independent Unionist', 'Independent  Progressive Unionist', 'Independent Liberal Unionist'],
  ['Ind O', 'Independent Other'],
  ['Ind N', 'Independent Nationalist', 'Ind Nat', 'unofficial (non-party) Sinn Féin'],
  ['Ind', 'Independent', 'Non party/Independent', 'Non-party', 'Non party', 'NON-P', 'Independent - Northern Ireland independence',
    "Non party/An Chomhdhail Phobail | People's Convention", 'Non party/Fathers Rights Responsibilities'],
  ['GP', 'Green Party', 'Green', 'Green Party Northern Ireland', 'Green / Ecology', 'Green/Comhaontas Glas', 'Green Alliance/Comhaontas Glas', 'G.P.'],
  ['PBP', 'People Before Profit', 'People Before Profit Alliance', 'P.B.P.A.'],
  ['S-PBP', 'Solidarity–People Before Profit', 'Solidarity-PBP', 'S.P.B.P.'],
  ['TUV', 'Traditional Unionist Voice'],
  ['CCLA', 'Cross-Community Labour Alternative'],
  ['CON', 'Conservative Party', 'Conservative', 'Conservatives', 'NI Conservatives'],
  ['AO', 'Aontú'],
  ['FF', 'Fianna Fáil', 'Fianna Fail'],
  ['FG', 'Fine Gael'],
  ['LAB', 'Labour Party', 'Irish Labour', 'Labour', 'Irish Labour Party', 'Lab.', 'LAB.', 'Ir Lab'],
  ['SD', 'Social Democrats'],
  ['PUP', 'Progressive Unionist Party', 'Progressive Unionist'],
  ['UKIP', 'UK Independence Party'],
  ['WP', "Workers' Party", 'Workers Party', "Workers'", 'W.P.'],
  ['SFWP', "Sinn Féin The Workers' Party", "Sinn Féin Workers'"],
  ['RC', 'Republican Clubs'],
  ['VUPP', 'Vanguard Unionist Progressive Party'],
  ['NILP', 'Northern Ireland Labour Party', 'NI Labour'],
  ['LPNI', 'Labour Party of Northern Ireland'],
  ['NALAB', 'Newtownabbey Labour'],
  ['NILRC', 'Northern Ireland Labour Representation Committee'],
  ['PD', 'Progressive Democrats', 'P.D.'],
  ['IIP', 'Irish Independence Party'],
  ['UPNI', 'Unionist Party of Northern Ireland'],
  ['CnaG', 'Cumann na nGaedheal'],
  ['UDP', 'Ulster Democratic Party'],
  ['UKUP', 'UK Unionist Party'],
  ['Nat', 'Nationalist Party', 'Nationalist Party (Northern Ireland)'],
  ['IPP', 'Irish Parliamentary Party', 'Irish Parliamentary'],
  ['UPUP', 'Ulster Popular Unionist Party'],
  ['SP', 'Socialist Party', 'S.P.'],
  ['IUA', 'Irish Unionist Alliance'],
  ['NIWC', "Northern Ireland Women's Coalition", "NI Women's Coalition"],
  ['LC', 'Labour Coalition'],
  ['IRSP', 'Irish Republican Socialist Party'],
  ['NLP', 'Natural Law Party', 'Natural Law'],
  ['FP', "Farmers' Party", 'Farmers'],
  ['CnaP', 'Clann na Poblachta'],
  ['INF', 'Irish National Federation'],
  ['CPI', 'Communist Party of Ireland'],
  ['RLP', 'Republican Labour Party', 'Republican Labour', 'Rep Lab'],
  ['BNP', 'British National Party'],
  ['CISTA', 'Cannabis Is Safer Than Alcohol'],
  ['DL', 'Democratic Left', 'Democratic Left (Ireland)'],
  ['INL', 'Irish National League'],
  ['UUUP', 'United Ulster Unionist Party'],
  ['CSP', 'Christian Solidarity Party', 'Comhar Criostai / Christian Solidarity', 'Comhar Criostai/Christian Solidarity', 'C.S.P.'],
  ['II', 'Independent Ireland'],
  ['RNU', 'Republican Network for Unity'],
  ['CnaT', 'Clann na Talmhan'],
  ['AAA', 'Anti-Austerity Alliance', 'A.A.A.'],
  ['ULP', 'Ulster Liberal Party', 'Ulster Liberal'],
  ['NP', 'National Party'],
  ['RSF', 'Republican Sinn Féin'],
  ['TIP', 'The Irish People'],
  ['UIM', 'Ulster Independence Movement'],
  ['LIB', 'Liberal Party', 'Liberal'],
  ['LU', 'Liberal Unionist'],
  ['NIUP', 'Northern Ireland Unionist Party', 'NI Unionist Party'],
  ['SEA', 'Socialist Environmental Alliance'],
  ['IFP', 'Irish Freedom Party'],
  ['DDI', 'Direct Democracy Ireland', 'D.D.I.'],
  ['SWP', 'Socialist Workers Party', 'Socialist Workers'],
  ['AHB', 'Anti H-Block'],
  ['Ind Lab', 'Independent Labour', 'Ind Lab'],
  ['AFIL', 'All-for-Ireland League', 'All-for-Ireland'],
  ['I4C', 'Independents 4 Change'],
  ['IA', 'Independent Alliance'],
  ['NCP', 'National Centre Party'],
  ['UCUNF', 'Ulster Conservatives and Unionists – New Force'],
  ['PDem', "People's Democracy", "People's Democracy (Ireland)"],
  ['NDP', 'National Democratic Party'],
  ['Eco', 'Ecology Party', 'Ecology', 'Ecology Party Ireland'],
  ['Ind Rep', 'Independent Republican', 'Ind Rep'],
  ['Ind FF', 'Independent Fianna Fáil', 'Independent Fianna Fail'],
  ['Ind FG', 'Independent Fine Gael'],
  ['Ind CON', 'Independent Conservative', 'Ind. Conservative'],
  ['Ind Soc', 'Independent Socialist'],
  ['IUP', 'Independent Unionist Party', 'Ind. Unionist Party'],
  ['Prot U', 'Protestant Unionist Party', 'Protestant Unionist'],
  ['PT SF', 'Pro-Treaty Sinn Féin'],
  ['AT SF', 'Anti-Treaty Sinn Féin'],
  ['DVP', 'Democrats and Veterans'],
  ['WUAG', 'Workers and Unemployed Action Group'],
  ['ULA', 'United Left Alliance'],
  ['IHA', 'Independent Health Alliance'],
  ['CC', 'Ceann Comhairle (Speaker)'],
  // Labels reviewed against the source data one by one. The "Lozenge" spellings are
  // ballot-paper artefacts of the same party; key() strips a trailing "Lozenge" before
  // matching, so one entry covers both, but they are listed where they occur in the data.
  ['RDT', 'Vote For Yourself / Rainbow Dream Ticket / Make Politicians History'],
  ['Joint', 'Joint Panel Nomination (Pro/Anti Treaty)'],
  ['ARG', 'An Rabharta Glas – Green Left', 'An Rabharta Glas – Green Left Lozenge'],
  ['HRRA', 'Housing Rights and Reform Alliance'],
  ['DLTU', 'Derry Labour and Trade Union Party'],
  ['UCDP', 'Ulster Christian Democratic Party'],
  ['SKIA', 'South Kerry Independent Alliance'],
  ['ILPU', 'Irish Loyal and Patriotic Union'],
  ['AÉ', 'Aontacht Eireann (Irish Unity)'],
  ['LTUG', 'Labour and Trade Union Group'],
  ['3W', 'Third Way (UK organisation)'],
  ['UIV', "Ulster's Independent Voice"],
  ['SRP', 'Socialist Republican Party'],
  ['KIA', 'Kerry Independent Alliance'],
  ['PPP', "People's Progressive Party"],
  ['CLP', 'Commonwealth Labour Party'],
  ['UCP', 'Ulster Constitution Party'],
  // The bare "Unity" spelling in the data resolves here too: the abbreviation is itself
  // a key, and both refer to the same 1970s Northern Ireland anti-unionist Unity label.
  ['Unity', 'Unity (Northern Ireland)'],
  ['PAW', 'Party for Animal Welfare'],
  ['UPA', 'Ulster Protestant Action'],
  ['UPL', 'Ulster Protestant League'],
  ['SBU', 'South Belfast Unionists'],
  ['Centre', 'Centre Party of Ireland'],
  ['ISN', 'Irish Socialist Network'],
  ['NDUK', 'National Democrats (UK)'],
  ['DP', 'Democratic Partnership'],
  ['NI1ST', 'Northern Ireland First'],
  ['IDP', 'Irish Democratic Party'],
  // The apostrophe is dropped before matching, so this covers both spellings in the data.
  ['TTA', "Town Tenants' Association", 'Town Tenants Association'],
  ['VPP', 'Volunteer Political Party'],
];

function key(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+lozenge$/i, '')
    .replace(/&/g, ' and ')
    .replace(/[.'’`]/g, '')
    .replace(/[–—\-_/,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const BY_KEY = new Map();
for (const [abbreviation, fullName, ...spellings] of PARTIES) {
  for (const spelling of [abbreviation, fullName, ...spellings]) {
    const k = key(spelling);
    if (k && !BY_KEY.has(k)) BY_KEY.set(k, { abbreviation, fullName });
  }
}

/** {abbreviation, fullName} for a party as spelled in the data, or null if unlisted. */
export function partyInfo(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const direct = BY_KEY.get(key(text));
  if (direct) return direct;
  // "Independent (Alan Chambers)", "Nationalist Party (Northern Ireland)"
  const withoutQualifier = key(text.replace(/\s*\([^)]*\)\s*$/, ''));
  return BY_KEY.get(withoutQualifier) || null;
}

export function partyAbbreviation(value) {
  return partyInfo(value)?.abbreviation || String(value ?? '').trim();
}

export function partyFullName(value) {
  return partyInfo(value)?.fullName || String(value ?? '').trim();
}

/**
 * HTML for a party name in a table cell: the abbreviation, with the full name on hover.
 * `escape` is the caller's HTML escaper.
 */
export function partyLabelHtml(value, escape) {
  const text = String(value ?? '').trim();
  const info = partyInfo(text);
  if (!info || info.abbreviation === info.fullName) return escape(text);
  return `<abbr class="party-abbr" title="${escape(info.fullName)}">${escape(info.abbreviation)}</abbr>`;
}
