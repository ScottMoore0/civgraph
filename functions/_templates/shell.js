/**
 * The site shell: document head, header, footer, support dialog and section navigation.
 *
 * THE single source of the shell markup (frontend-plan.md section 4). Server-rendered pages
 * call page() at request time; the build step that stamps static pages
 * (scripts/build-site-partials.mjs) is to import these same functions instead of reading
 * partials/*.html (step F1). Until then tests/unit/shell.test.mjs requires head(), header(),
 * footer() and supportModal() to produce exactly what the partials produce, so the two
 * sources cannot drift while both exist.
 *
 * No file system, no DOM: this runs in Pages Functions and in Node.
 */
import { attrs, html, raw } from '../_lib/html.js';

export const SITE_ORIGIN = 'https://civgraph.net';
export const SITE_NAME = 'Civgraph';

/**
 * The one copy of the theme bootstrap. It runs before first paint, so the saved or system
 * theme is on <html data-theme> before any stylesheet applies. One storage key, `theme`.
 */
export const THEME_BOOTSTRAP = "<script>(function(){var t=null;try{t=localStorage.getItem('theme');}catch(e){}if(t!=='dark'&&t!=='light'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;})();</script>";

const SVG_OPEN = (cls, name, extra = '') => `<svg aria-hidden="true" class="${cls}" data-icon="lucide" data-icon-name="${name}"${extra} fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">`;

/** Main navigation, in order. `key` is what header({ active }) and the partial markers use. */
export const NAV = [
  {
    key: 'home', label: 'Home', href: '/', icon: 'house',
    paths: '\n<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path>\n<path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  },
  {
    key: 'maps', label: 'Maps', href: '/maps/', icon: 'map',
    paths: '\n<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"></path>\n<path d="M15 5.764v15"></path><path d="M9 3.236v15"></path>',
  },
  {
    key: 'browse', label: 'Browse', href: '/browse/', icon: 'search',
    paths: '\n<circle cx="11" cy="11" r="8"></circle>\n<path d="m21 21-4.3-4.3"></path>',
  },
  {
    key: 'apps', label: 'Apps', href: '/apps/', icon: 'layout-grid',
    paths: '\n<rect height="7" rx="1" width="7" x="3" y="3"></rect>\n<rect height="7" rx="1" width="7" x="14" y="3"></rect>\n<rect height="7" rx="1" width="7" x="14" y="14"></rect>\n<rect height="7" rx="1" width="7" x="3" y="14"></rect>',
  },
  {
    key: 'about', label: 'About', href: '/pages/about.html', icon: 'info',
    paths: '\n<circle cx="12" cy="12" r="10"></circle>\n<path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
  },
];

export const NAV_KEYS = new Set([...NAV.map((n) => n.key), 'none']);

const LOGO = '/assets/pages/img/bd2feea987bf.svg';

/**
 * The shared head lines: theme bootstrap, chrome stylesheet and chrome script.
 * @param {object} [options]
 * @param {(path: string) => string|null} [options.version]  content hash for an asset path;
 *   the build passes a real one, Functions pass the build's manifest (or nothing, and the
 *   URLs go out without ?v=).
 */
/** The i18n reveal script of partials/site-head.html, with the runtime's URL filled in. */
const LANG_PREVIEW = (src) => "<script>(function(){var K='civgraph.langPreview',S='" + src + "',on=false;function load(){var i=window.civgraphI18n;if(i){if(i.show)i.show();return;}if(document.querySelector('script[data-i18n-runtime]'))return;var s=document.createElement('script');s.src=S;s.setAttribute('data-i18n-runtime','');document.head.appendChild(s);}window.civgraphLangReveal=function(){try{localStorage.setItem(K,'1');}catch(e){}load();};try{if(/[?&]lang-preview=0(?:&|$)/.test(location.search)){localStorage.removeItem(K);localStorage.removeItem('civgraph.lang');}on=localStorage.getItem(K)==='1';}catch(e){}if(on)load();})();</script>";

export function head({ version } = {}) {
  const url = (path) => {
    const v = version ? version(path) : null;
    return v ? `/${path}?v=${v}` : `/${path}`;
  };
  return raw([
    THEME_BOOTSTRAP,
    // The language control (fc1efce887): loads nothing unless the reader has revealed it.
    LANG_PREVIEW(url('assets/i18n/i18n.js')),
    `<link rel="stylesheet" href="${url('assets/site/site-chrome.css')}">`,
    `<script defer src="${url('assets/site/site-chrome.js')}"></script>`,
  ].join('\n'));
}

function navLink(item, active) {
  const on = item.key === active;
  return `<a class="app-header__link${on ? ' app-header__link--active' : ''}" href="${item.href}"${on ? ' aria-current="page"' : ''}>`
    + `${SVG_OPEN('icon', item.icon)}${item.paths}</svg><span>${item.label}</span></a>`;
}

/**
 * The site header and its collapsed mobile navigation (behaviour: assets/site/site-chrome.js).
 * @param {{active?: string, layout?: string}} [options] active is a NAV key or 'none';
 *   layout is 'page' (default) or 'app' (the map app's full-bleed header).
 */
export function header({ active = 'none', layout = 'page' } = {}) {
  if (!NAV_KEYS.has(active)) throw new Error(`header(): active must be one of ${[...NAV_KEYS].join(', ')}`);
  if (!/^[a-z-]+$/.test(layout)) throw new Error('header(): layout must be a plain word');
  return raw([
    `<header class="app-header" data-site-chrome data-header-layout="${layout}">`,
    '<a class="app-header__brand" href="/">',
    `<img alt="" class="app-header__logo-icon" src="${LOGO}"/>`,
    '<span class="app-header__wordmark">Civgraph</span>',
    '</a>',
    '<button aria-controls="mainNav" aria-expanded="false" aria-label="Open navigation" class="mobile-menu-toggle" type="button">',
    SVG_OPEN('mobile-menu-toggle__menu', 'menu'),
    '<path d="M4 12h16"></path><path d="M4 6h16"></path><path d="M4 18h16"></path>',
    '</svg>',
    SVG_OPEN('mobile-menu-toggle__close', 'x'),
    '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    '</svg>',
    '</button>',
    '<nav aria-label="Main navigation" class="app-header__nav" id="mainNav">',
    ...NAV.map((item) => navLink(item, active)),
    '<button aria-controls="supportModal" aria-haspopup="dialog" class="support-btn" data-support-open id="supportBtn" title="Support Civgraph" type="button">',
    '<svg aria-hidden="true" class="support-btn__icon" data-icon="lucide" data-icon-name="heart" fill="currentColor" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16">',
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
    '<span class="support-btn__text">Support Us</span>',
    '</button>',
    '<button aria-label="Toggle dark mode" class="theme-toggle" data-theme-toggle id="themeToggle" title="Toggle dark mode" type="button">',
    SVG_OPEN('theme-toggle__icon--sun', 'sun'),
    '<circle cx="12" cy="12" r="4"></circle>',
    '<path d="M12 2v2"></path><path d="M12 20v2"></path>',
    '<path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path>',
    '<path d="M2 12h2"></path><path d="M20 12h2"></path>',
    '<path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>',
    SVG_OPEN('theme-toggle__icon--moon', 'moon'),
    '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"></path></svg>',
    '</button>',
    '</nav>',
    '</header>',
  ].join('\n'));
}

// The submission mailto is the site's own public contact link, as in partials/site-footer.html.
const SUBMIT_MAP_HREF = 'mailto:scott@civgraph.net?subject=Civgraph%20map%20submission&body=What%20the%20map%20shows%20%28the%20area%2C%20the%20subject%2C%20and%20the%20year%20or%20period%20it%20covers%29%3A%0A%0A%0AWhere%20it%20came%20from%20%28who%20made%20it%2C%20and%20where%20you%20got%20it%29%3A%0A%0A%0AWhat%20form%20it%20is%20in%20%28a%20scan%2C%20a%20PDF%2C%20a%20shapefile%2C%20GeoJSON%2C%20or%20something%20else%29%3A%0A%0A%0AWhether%20it%20can%20be%20republished%2C%20and%20under%20what%20licence%2C%20if%20you%20know%3A%0A%0A%0AYour%20name%2C%20if%20you%20would%20like%20the%20contribution%20credited%3A%0A%0A';

export function footer() {
  return raw([
    '<footer class="ftr">',
    '<div class="ftr__inner">',
    '<div class="ftr__top">',
    '<a aria-label="Civgraph home" class="ftr__brand" href="/">',
    `<img alt="" class="ftr__logo" src="${LOGO}"/>`,
    '<span class="ftr__wordmark">Civgraph</span>',
    '</a>',
    '<nav aria-label="Footer navigation" class="ftr__nav">',
    '<a href="/maps/">Maps</a>',
    '<a href="/browse/">Browse</a>',
    '<a href="/pages/about.html">About</a>',
    `<a href="${SUBMIT_MAP_HREF}">Submit a map</a>`,
    '</nav>',
    '</div>',
    '<div class="ftr__rule"></div>',
    '<div class="ftr__bottom">',
    '<p class="ftr__tagline">All the data on Ireland’s history, geography, politics and demographics.</p>',
    '<div class="ftr__meta">© Civgraph</div>',
    '</div>',
    '</div>',
    '</footer>',
  ].join('\n'));
}

export function supportModal() {
  return raw([
    '<div aria-label="Support Civgraph" aria-modal="true" class="support-modal hidden" id="supportModal" role="dialog">',
    '<div class="support-modal__backdrop"></div>',
    '<div class="support-modal__content">',
    '<div class="support-modal__header">',
    '<h2 class="support-modal__title">Support Civgraph</h2>',
    '<button aria-label="Close" class="support-modal__close" type="button">&times;</button>',
    '</div>',
    '<div class="support-modal__options">',
    '<a class="support-modal__option support-modal__option--kofi" href="https://ko-fi.com/scottmoore0" rel="noopener noreferrer" target="_blank">',
    '<svg aria-hidden="true" class="support-modal__logo" fill="none" height="28" viewBox="0 0 24 24" width="28" xmlns="http://www.w3.org/2000/svg">',
    '<path d="M23 2H3.5C2.67 2 2 2.67 2 3.5V17.5C2 18.33 2.67 19 3.5 19H16.5C17.33 19 18 18.33 18 17.5V15H19.5C21.43 15 23 13.43 23 11.5V5.5C23 3.57 21.43 2 19.5 2H23ZM19.5 13H18V4H19.5C20.33 4 21 4.67 21 5.5V11.5C21 12.33 20.33 13 19.5 13Z" fill="currentColor"/>',
    '<path d="M12.5 7C12 6.5 11.3 6.2 10.5 6.2C9.7 6.2 9 6.5 8.5 7C8 6.5 7.3 6.2 6.5 6.2C4.8 6.2 3.5 7.5 3.5 9.2C3.5 12.3 8.5 15 8.5 15C8.5 15 13.5 12.3 13.5 9.2C13.5 7.5 12.2 6.2 10.5 6.2" fill="currentColor"/>',
    '</svg>',
    '<div>',
    '<strong>Tip me via Ko-fi</strong>',
    '<span>One-off tip, from as little as £3</span>',
    '</div>',
    '</a>',
    '<a class="support-modal__option support-modal__option--sub" href="https://scottmoore.xyz/p/support-the-boundaries-website" rel="noopener noreferrer" target="_blank">',
    '<svg aria-hidden="true" class="support-modal__logo" fill="none" height="28" viewBox="0 0 24 24" width="28" xmlns="http://www.w3.org/2000/svg">',
    '<path d="M22 4.01H2V6.01H22V4.01Z" fill="currentColor"/>',
    '<path d="M22 8.01H2V10.01H22V8.01Z" fill="currentColor"/>',
    '<path d="M2 12.01V22.01L12 16.01L22 22.01V12.01H2Z" fill="currentColor"/>',
    '</svg>',
    '<div>',
    '<strong>Become a subscriber via Substack</strong>',
    '<span>£5/month or £45/year</span>',
    '</div>',
    '</a>',
    '</div>',
    '<div class="support-modal__author">',
    '<img alt="Scott Moore" class="support-modal__avatar" decoding="async" height="64" loading="lazy" src="/assets/images/scott-moore.jpg" width="64">',
    '<p class="support-modal__author-label">A message from Scott Moore:</p>',
    '</div>',
    '<div class="support-modal__message">',
    '<p>Support the work of myself and other contributors with a one-off tip, or a subscription of £5 a month, or £45 a year.</p>',
    "<p>I've gone out of pocket to put together Civgraph, through subscriptions to newspaper archives, buying a better computer to enable me to produce maps like the 1984 and 1972 council wards maps in digitised formats, and spending on tools to help me develop the website.</p>",
    '<p>With your support, I can cover the costs I incur month to month, work with volunteers to make a greater range of maps available, expand the features on the website, and extend the website beyond maps and boundaries, to include data like election results, Hansard and biographies, all in one place.</p>',
    "<p>All support is appreciated, but if you can't help, don't worry - I release all my maps under an open source license (Creative Commons BY-SA 4.0), and the content of the site will be free forever.</p>",
    '</div>',
    '</div>',
    '</div>',
  ].join('\n'));
}

/**
 * A breadcrumb / section bar.
 * @param {{label?: string, items: Array<{href?: string, label: string}>, current?: number}} options
 *   current is the index of the item that is this page (default: the last).
 */
export function sectionNav({ label = 'Breadcrumb', items = [], current } = {}) {
  if (!items.length) return raw('');
  const here = current ?? items.length - 1;
  return html`<nav class="cg-section-nav"${attrs({ 'aria-label': label })}><ol>${items.map((item, i) => html`<li>${
    i === here || !item.href
      ? html`<span${attrs({ 'aria-current': i === here && 'page' })}>${item.label}</span>`
      : html`<a${attrs({ href: item.href })}>${item.label}</a>`
  }</li>`)}</ol></nav>`;
}

/** The design-system stylesheets every shell page loads, in cascade order. */
export const UI_STYLES = ['assets/ui/tokens.css', 'assets/ui/tokens-legacy.css', 'assets/ui/base.css', 'assets/ui/components.css'];

/**
 * A whole document.
 * @param {object} p
 * @param {string} p.title              <title>, already including " – Civgraph" if wanted
 * @param {string} [p.description]
 * @param {string} [p.canonical]        absolute URL
 * @param {object} [p.og]               extra Open Graph properties ({ type: 'profile' })
 * @param {string} [p.section]          NAV key for the header
 * @param {string} [p.layout]           header layout
 * @param {*}      p.body               html`` for <main>
 * @param {string[]} [p.styles]         extra stylesheet paths (no leading slash)
 * @param {string[]} [p.scripts]        extra deferred module scripts (no leading slash)
 * @param {string} [p.robots]           e.g. 'noindex'
 * @param {object} [p.jsonLd]           structured data, serialised safely into a script
 * @param {(path: string) => string|null} [p.version]
 */
export function page({
  title, description, canonical, og = {}, section = 'none', layout = 'page', body,
  styles = [], scripts = [], robots, jsonLd, version,
}) {
  const url = (path) => {
    const v = version ? version(path) : null;
    return v ? `/${path}?v=${v}` : `/${path}`;
  };
  const ogTags = canonical ? {
    'og:type': 'website', 'og:site_name': SITE_NAME, 'og:url': canonical, 'og:title': title,
    ...(description ? { 'og:description': description } : {}), ...og,
  } : og;
  // JSON in a <script> must not be able to close it: escape every "<".
  const ld = jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`) : null;
  return html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
${description ? html`<meta name="description"${attrs({ content: description })}>\n` : ''}${robots ? html`<meta name="robots"${attrs({ content: robots })}>\n` : ''}${canonical ? html`<link rel="canonical"${attrs({ href: canonical })}>\n` : ''}${Object.entries(ogTags).map(([property, content]) => html`<meta${attrs({ property, content })}>\n`)}<link rel="preload" href="/assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="icon" type="image/svg+xml" href="/assets/images/favicon.svg">
${head({ version })}
${[...UI_STYLES, ...styles].map((path) => html`<link rel="stylesheet"${attrs({ href: url(path) })}>\n`)}${scripts.map((path) => html`<script type="module"${attrs({ src: url(path) })}></script>\n`)}${ld}
</head>
<body class="cg-page">
<a class="cg-skip-link" href="#main-content">Skip to main content</a>
<div id="cg-announcer" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>
${header({ active: section, layout })}
${supportModal()}
<main id="main-content" class="cg-main" tabindex="-1">
${body}
</main>
${footer()}
</body>
</html>
`;
}
