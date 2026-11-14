/**
 * "Embed this result" (el-context, 14 Nov 2026): a closed panel on an election's or a contest's page
 * with a preview of the widget, the HTML snippet to copy, and its licence. Not a route. SWITCHED OFF:
 * embedOfferSection() is empty unless config.js EMBED.offered is true, or a local server previews it
 * (lib/embed.js says how to switch embeds on).
 */
import { SITE } from '../../../pkg/config/src/config.js';
import { EMBED } from '../config.js';
import { EMBED_PREVIEW_KEY, embedOffered, embedSnippet, embedUrl } from '../lib/embed.js';
import { esc } from '../lib/format.js';

/** Every fixed text of the panel (keys of data/i18n/strings/elections.txt). */
export const EMBED_TEXT = Object.freeze({
  heading: 'Embed this result',
  lead: 'Put this result on your own page: copy the HTML below. It shows the result, links back here and names the licence: Civgraph\'s compilation is CC BY 4.0, and each source keeps its own licence.',
  snippet: 'HTML to copy',
  copy: 'Copy the HTML',
  copied: 'Copied',
  preview: 'Preview',
});

/** Whether this page offers the panel (browser only). */
function offered() {
  let preview = null;
  try { preview = localStorage.getItem(EMBED_PREVIEW_KEY); } catch { /* storage blocked */ }
  return embedOffered(EMBED.offered, location.hostname, preview);
}

/**
 * The panel's markup, or '' while embeds are off.
 * @param {{ election: string, contest?: string | null, title: string }} what the election's slug, the contest's, the result's title
 */
export function embedOfferSection({ election, contest = null, title }) {
  if (!offered()) return '';
  const snippet = embedSnippet({ origin: SITE.origin, election, contest, title });
  const preview = embedUrl(location.origin, election, contest);
  return `<section aria-labelledby="el-embed" class="el-embed"><h2 id="el-embed">${esc(EMBED_TEXT.heading)}</h2>
    <details data-el-embed><summary>${esc(EMBED_TEXT.heading)}</summary>
      <p>${esc(EMBED_TEXT.lead)}</p>
      <label class="el-embed-label" for="el-embed-code">${esc(EMBED_TEXT.snippet)}</label>
      <textarea id="el-embed-code" class="el-embed-code" rows="4" readonly>${esc(snippet)}</textarea>
      <p><button type="button" class="cg-button" data-el-embed-copy>${esc(EMBED_TEXT.copy)}</button> <span class="el-muted" data-el-embed-status aria-live="polite"></span></p>
      <h3>${esc(EMBED_TEXT.preview)}</h3>
      <iframe class="el-embed-preview" src="${esc(preview)}" title="${esc(title)}" loading="lazy"></iframe>
    </details></section>`;
}

/**
 * Wire the copy button (a page without the panel is left alone).
 * @param {HTMLElement} root @param {import('../app.js').ViewContext} ctx
 */
export function mountEmbedOffer(root, ctx) {
  const button = root.querySelector('[data-el-embed-copy]');
  const code = /** @type {HTMLTextAreaElement | null} */ (root.querySelector('#el-embed-code'));
  const status = /** @type {HTMLElement | null} */ (root.querySelector('[data-el-embed-status]'));
  if (!button || !code || !status) return;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.value);
    } catch {
      // No clipboard (an insecure page, a refusal): select the text for the reader to copy.
      code.select();
    }
    if (!ctx.stale()) status.textContent = EMBED_TEXT.copied;
  }, { signal: ctx.signal });
}
