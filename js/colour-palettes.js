/**
 * Colour palettes and per-feature colour resolvers for vector layers.
 *
 * Three palette types are supported via maps.json fields:
 *
 *   colorMap (categorical):
 *     {
 *       property: "MAX_PERIOD" | ["MAX_PERIOD", "MAX_ERA"],   // single key or fallback chain
 *       palette:  "iugs" | "iugs_full" | "wfd" | "superficial" | { ... },
 *       default:  "#999999"
 *     }
 *
 *   colorScale (continuous):
 *     {
 *       property:    "AS",
 *       ramp:        "viridis" | "inferno" | "magma" | "plasma",
 *       domain:      [0, 50],
 *       logarithmic: true | false
 *     }
 *
 * IUGS / ICS chronostratigraphic colours come from the International
 * Commission on Stratigraphy chart (https://stratigraphy.org/chart),
 * approximated to single-period RGBs. Sub-periods (Mississippian etc.)
 * are mapped to their parent period for simplicity.
 *
 * WFD ecological status / potential palette follows the standard
 * 5-class scheme used in EU/NIEA WFD reporting.
 *
 * BGS-style superficial deposits palette is approximated from typical
 * Quaternary-deposit cartography conventions.
 *
 * Viridis / Inferno / Magma / Plasma ramp lookup tables are sampled
 * 11-step from matplotlib's reference colormaps (perceptually uniform,
 * colour-blind friendly).
 */

const IUGS = {
    QUATERNARY:        '#F9F97F',
    NEOGENE:           '#FFE619',
    PALAEOGENE:        '#FDB46C',
    'PALEOGENE':       '#FDB46C',
    CRETACEOUS:        '#7FC64E',
    JURASSIC:          '#34B2C9',
    TRIASSIC:          '#812B92',
    PERMIAN:           '#F04028',
    CARBONIFEROUS:     '#67A599',
    DEVONIAN:          '#CB8C37',
    SILURIAN:          '#B3E1B6',
    ORDOVICIAN:        '#009270',
    CAMBRIAN:          '#7FA056',
    // Era fallback (when MAX_PERIOD null but MAX_ERA set)
    NEOPROTEROZOIC:    '#FEB342',
    MESOPROTEROZOIC:   '#F73B89',
    PALAEOPROTEROZOIC: '#F44D7B',
    'PALEOPROTEROZOIC': '#F44D7B',
    ARCHAEAN:          '#DA037F',
    'ARCHEAN':         '#DA037F',
    HADEAN:            '#AB2769',
    PROTEROZOIC:       '#FEB342',
    PHANEROZOIC:       '#9AD9DD',
    PRECAMBRIAN:       '#F44D7B',
    PALAEOZOIC:        '#9AD9DD',
    'PALEOZOIC':       '#9AD9DD',
    MESOZOIC:          '#67C5CA',
    CENOZOIC:          '#F2F91D',
};

const WFD = {
    HIGH:     '#2978D5',
    GOOD:     '#5BC75B',
    MODERATE: '#F0DD15',
    POOR:     '#FF8527',
    BAD:      '#DC1B1B',
    // Ecological-Potential variants for Heavily Modified Water Bodies
    MEP:      '#6FA8DC',  // Maximum
    GEP:      '#93D293',  // Good
    'MEP*':   '#6FA8DC',
    PEP:      '#FFB174',  // Poor
    BEP:      '#E66666',  // Bad
    // Special
    'NO DATA': '#9E9E9E',
};

const SUPERFICIAL = {
    'TILL':                          '#C28B6E',
    'PEAT':                          '#6B4423',
    'ALLUVIUM':                      '#FFE699',
    'GLACIAL SAND AND GRAVEL':       '#F4A460',
    'GLACIOFLUVIAL SHEET DEPOSITS':  '#E8B271',
    'GLACIOLACUSTRINE DEPOSITS':     '#BFA47C',
    'LACUSTRINE ALLUVIUM':           '#D4B884',
    'BLOWN SAND':                    '#FFF8DC',
    'LANDSLIDE DEPOSITS':            '#B8460E',
    'RAISED BEACH DEPOSITS':         '#DCC9A0',
    'RAISED MARINE DEPOSITS':        '#C7B58D',
    'DIATOMITE':                     '#E8E8E8',
};

const PALETTES = {
    iugs: IUGS,
    iugs_full: IUGS,
    wfd: WFD,
    superficial: SUPERFICIAL,
};

// 11-stop sampled viridis/inferno/magma/plasma from matplotlib.
const RAMPS = {
    viridis: ['#440154','#482878','#3E4989','#31688E','#26828E','#1F9E89','#35B779','#6CCE59','#B4DD2C','#FDE725','#FDE725'],
    inferno: ['#000004','#1B0C41','#4A0C6B','#781C6D','#A52C60','#CF4446','#ED6925','#FB9A06','#F7D03C','#FCFFA4','#FCFFA4'],
    magma:   ['#000004','#180F3D','#440F76','#721F81','#9E2F7F','#CD4071','#F1605D','#FE9F6D','#FEC589','#FCFDBF','#FCFDBF'],
    plasma:  ['#0D0887','#41049D','#6A00A8','#8F0DA4','#B12A90','#CC4778','#E16462','#F2844B','#FCA636','#FCCE25','#F0F921'],
};

function lerpHex(a, b, t) {
    const ai = parseInt(a.slice(1), 16);
    const bi = parseInt(b.slice(1), 16);
    const ar = (ai >> 16) & 255, ag = (ai >> 8) & 255, ab = ai & 255;
    const br = (bi >> 16) & 255, bg = (bi >> 8) & 255, bb = bi & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const b2 = Math.round(ab + (bb - ab) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b2).toString(16).slice(1);
}

function rampSample(rampName, t) {
    const stops = RAMPS[rampName] || RAMPS.viridis;
    const clamped = Math.max(0, Math.min(1, t));
    const x = clamped * (stops.length - 1);
    const i = Math.floor(x);
    const frac = x - i;
    if (i >= stops.length - 1) return stops[stops.length - 1];
    return lerpHex(stops[i], stops[i + 1], frac);
}

function resolveCategoricalColour(feature, cfg) {
    if (!cfg || !feature?.properties) return null;
    const props = feature.properties;
    const keys = Array.isArray(cfg.property) ? cfg.property : [cfg.property];
    const palette = typeof cfg.palette === 'string'
        ? PALETTES[cfg.palette]
        : (cfg.palette || cfg.values);
    if (!palette) return null;
    for (const key of keys) {
        const raw = props[key];
        if (raw == null || raw === '') continue;
        const k = String(raw).toUpperCase().trim();
        if (palette[k]) return palette[k];
        // exact-case fallback
        if (palette[raw]) return palette[raw];
    }
    return cfg.default || null;
}

function resolveContinuousColour(feature, cfg) {
    if (!cfg || !feature?.properties) return null;
    const raw = feature.properties[cfg.property];
    const v = typeof raw === 'number' ? raw : parseFloat(raw);
    if (!isFinite(v)) return cfg.default || null;
    const [lo, hi] = cfg.domain || [0, 1];
    let t;
    if (cfg.logarithmic) {
        const safe = Math.max(v, 1e-9);
        const safeLo = Math.max(lo, 1e-9);
        const safeHi = Math.max(hi, 1e-9);
        t = (Math.log(safe) - Math.log(safeLo)) / (Math.log(safeHi) - Math.log(safeLo));
    } else {
        t = (v - lo) / (hi - lo);
    }
    return rampSample(cfg.ramp || 'viridis', t);
}

/**
 * Resolve the colour for one feature using whatever colour spec is on
 * the map config. Returns hex string, or null if no spec applies.
 */
export function getFeatureColour(feature, mapConfig) {
    if (!mapConfig || !feature) return null;
    if (mapConfig.colorMap) {
        const c = resolveCategoricalColour(feature, mapConfig.colorMap);
        if (c) return c;
    }
    if (mapConfig.colorScale) {
        const c = resolveContinuousColour(feature, mapConfig.colorScale);
        if (c) return c;
    }
    return null;
}

export const PALETTE_TABLES = { IUGS, WFD, SUPERFICIAL, RAMPS };
