/**
 * Icons for the rebuilt catalogue: Lucide (ISC licence), drawn the way the rest of the site draws
 * them (src/ui-controller.js, lucideIcon) -- 24px grid, 2px round strokes, currentColor. The four
 * section icons are the same paths as the current pane's section bar.
 */
const PATHS = {
  // Sections, as in the current pane
  vote: '<path d="m9 12 2 2 4-4"/><path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z"/><path d="M22 19H2"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  // Book categories, as in the current pane
  'clipboard-list': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  landmark: '<path d="M10 18v-7"/><path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>',
  'chart-column': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  // Shelves
  'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  castle: '<path d="M10 5V3"/><path d="M14 5V3"/><path d="M15 21v-3a3 3 0 0 0-6 0v3"/><path d="M18 3v8"/><path d="M18 5H6"/><path d="M22 11H2"/><path d="M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9"/><path d="M6 3v8"/>',
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  droplets: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  // Actions
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  menu: '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
  crosshair: '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4"/><path d="M6 12H2"/><path d="M12 6V2"/><path d="M12 22v-4"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  'arrow-left-right': '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  // Drawn for Civgraph after Alessio Coci's sketches (2026-10-18): the election bodies and three
  // Boundaries shelves each get a picture of their own instead of sharing a generic building.
  'portico': '<path d="M3 8.5 12 3.5l9 5z"/><path d="M4 10.5h16"/><path d="M6.5 10.5v7"/><path d="M10 10.5v7"/><path d="M14 10.5v7"/><path d="M17.5 10.5v7"/><path d="M4 17.5h16"/><path d="M2.5 20.5h19"/>',
  'clock-tower': '<path d="M10 21.5V7.5h4v14"/><path d="M10 7.5 12 2.5l2 5"/><circle cx="12" cy="10.5" r="1.4"/><path d="M2.5 21.5h19"/><path d="M4 21.5v-6h6"/><path d="M14 15.5h6v6"/><path d="M4 15.5v-2"/><path d="M7 15.5v-2"/><path d="M17 15.5v-2"/><path d="M20 15.5v-2"/><path d="M6.5 18.5v1"/><path d="M17.5 18.5v1"/>',
  'stormont': '<path d="M12 7V2"/><path d="M12 2h3.5l-.9 1.2.9 1.2H12"/><path d="M8.5 10.5a3.5 3.5 0 0 1 7 0"/><path d="M3 21v-8h18v8"/><path d="M7.5 13v-2.5h9V13"/><path d="M2 21h20"/><path d="M10 21v-5"/><path d="M12 21v-5"/><path d="M14 21v-5"/><path d="M5.5 15.5h1"/><path d="M5.5 18.5h1"/><path d="M17.5 15.5h1"/><path d="M17.5 18.5h1"/>',
  'offices': '<path d="M2.5 21h19"/><path d="M4.5 21V3.5h8V21"/><path d="M12.5 8.5h7V21"/><path d="M7 7h.5"/><path d="M10 7h.5"/><path d="M7 10.5h.5"/><path d="M10 10.5h.5"/><path d="M7 14h.5"/><path d="M10 14h.5"/><path d="M7.5 21v-3h2v3"/><path d="M15.5 12h1.5"/><path d="M15.5 15h1.5"/><path d="M15.5 18h1.5"/>',
  'town-hall': '<path d="M12 6V2"/><path d="M12 2h3.5l-.9 1.2.9 1.2H12"/><path d="M7.5 10.5 12 6.5l4.5 4"/><circle cx="12" cy="11" r="1.3"/><path d="M3 21v-7.5l4.5-3h9l4.5 3V21"/><path d="M2 21h20"/><path d="M10.5 21v-3a1.5 1.5 0 0 1 3 0v3"/><path d="M5.5 15.5h1.5"/><path d="M5.5 18.5h1.5"/><path d="M17 15.5h1.5"/><path d="M17 18.5h1.5"/>',
  'eu-flag': '<path d="M4 22V3"/><path d="M4 4c2.7-1.3 5.3 1.3 8 0s5.3-1.3 8 0v9.5c-2.7-1.3-5.3 1.3-8 0s-5.3-1.3-8 0"/><circle cx="12.00" cy="5.90" r="0.5" fill="currentColor" stroke="none"/><circle cx="13.35" cy="6.26" r="0.5" fill="currentColor" stroke="none"/><circle cx="14.34" cy="7.25" r="0.5" fill="currentColor" stroke="none"/><circle cx="14.70" cy="8.60" r="0.5" fill="currentColor" stroke="none"/><circle cx="14.34" cy="9.95" r="0.5" fill="currentColor" stroke="none"/><circle cx="13.35" cy="10.94" r="0.5" fill="currentColor" stroke="none"/><circle cx="12.00" cy="11.30" r="0.5" fill="currentColor" stroke="none"/><circle cx="10.65" cy="10.94" r="0.5" fill="currentColor" stroke="none"/><circle cx="9.66" cy="9.95" r="0.5" fill="currentColor" stroke="none"/><circle cx="9.30" cy="8.60" r="0.5" fill="currentColor" stroke="none"/><circle cx="9.66" cy="7.25" r="0.5" fill="currentColor" stroke="none"/><circle cx="10.65" cy="6.26" r="0.5" fill="currentColor" stroke="none"/>',
  'ballot-box': '<path d="M4 11.5h16V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="m4 11.5 2-3h12l2 3"/><path d="M10 10V8.5"/><path d="M10 8.5 11.7 3l4 1.2-1.5 4.3"/><path d="m9 16.5 2 2 4-4"/>',
  'lectern': '<circle cx="12" cy="4.5" r="2.3"/><path d="M7.5 11.5a4.5 4.5 0 0 1 9 0"/><path d="M5 11.5h14l-1.2 3H6.2z"/><path d="M9 14.5v6"/><path d="M15 14.5v6"/><path d="M6.5 20.5h11"/><path d="M12.5 11.5 14 9.5"/>',
  'atlas': '<path d="M2 5.5 7 4l5 1.8L17 4l5 1.5v14L17 18l-5 1.8L7 18l-5 1.5z"/><path d="M12 5.8v14"/><path d="M4.5 9c1.2 1 2.2 0 3.2 1.2s.3 2.2 1.6 2.8"/><path d="M4.8 15.2c1-.6 2.2.4 3.4-.4"/><path d="M14.5 8.5h.01"/><path d="M16.2 10h.01"/><path d="M17.8 11.6h.01"/><path d="M19.2 13.4h.01"/>',
  'land-parcel': '<path d="M3 5.5 12 3l9 3-1.2 14L9 21.5 3.5 19z"/><path d="M15.4 4.2 14 20.7"/><path d="M3.3 12.5l11.4-.4"/><path d="m14.4 15 5.8-.3"/><path d="M5.8 9.6 8 7.8l2.2 1.8v2.2H5.8z"/>',
  'castle-harp': '<path d="M3.5 21V8.5H5V6.5h2v2h1.5V6.5h2v2H12V21"/><path d="M2 21h11.5"/><path d="M6.3 21v-2.8a1.5 1.5 0 0 1 3 0V21"/><path d="M15.2 8.8c-.4 4.3.1 8.6 1.2 12.2"/><path d="M15.2 8.8c2.3-.4 4.2-1.9 5.8-4"/><path d="M21 4.8 16.4 21"/><path d="M17.3 8v8.5"/><path d="M19.2 6.6v6.4"/>',
};

// The drawn icons carry more detail than Lucide's, so they use a finer line to stay legible at 18px.
const FINE = new Set(['portico', 'clock-tower', 'stormont', 'offices', 'town-hall', 'eu-flag', 'ballot-box', 'lectern', 'atlas', 'land-parcel', 'castle-harp']);

export function icon(name, cls = 'cn-icon') {
  const width = FINE.has(name) ? 1.6 : 2;
  return `<svg aria-hidden="true" class="${cls}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${width}" viewBox="0 0 24 24">${PATHS[name] || PATHS.map}</svg>`;
}

/** Each shelf's icon and colour: the colour marks the shelf's icon and heading, nothing else. */
export const SHELF_LOOK = {
  'land-divisions': ['atlas', '#c08a3e'],
  'government-and-administration': ['landmark', '#6875d6'],
  'elections-and-representation': ['vote', '#c84b8f'],
  'people-and-places': ['users', '#1f9e8f'],
  'planning-and-property': ['land-parcel', '#8a63d2'],
  transport: ['route', '#e07b2a'],
  'heritage-and-culture': ['castle-harp', '#c0504d'],
  'local-services-and-amenities': ['building', '#2f8fce'],
  water: ['droplets', '#3a6fd8'],
  'environment-and-land-use': ['leaf', '#3e9b4f'],
  'earth-and-terrain': ['mountain', '#8c7b6b'],
  'regional-divides': ['split', '#7a8597'],
  environment: ['leaf', '#3e9b4f'],
};

/** Shelves a section shows as one (Phelim Birch's review, 2026-10-11): Boundaries has a few rows
 * on each of these, so they share an Environment shelf there. */
export const MERGED_SHELVES = {
  boundaries: { environment: { name: 'Environment', shelves: ['local-services-and-amenities', 'water', 'environment-and-land-use', 'earth-and-terrain'] } },
};

/** Sections that list their rows straight, with no shelf or subject headings. */
export const FLAT_SECTIONS = new Set(['statistics', 'historic']);

/** Book category id -> icon, as in the current pane. */
export const BOOK_CATEGORY_ICONS = {
  'boundary-reports': 'clipboard-list',
  'parliamentary-debates': 'landmark',
  'election-results': 'vote',
  'census-reports': 'chart-column',
  legislation: 'scale',
  other: 'library',
};
