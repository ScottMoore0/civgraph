import { browsePageHandler } from '../../_browse-page.js';

// GET /browse/offices/<slug>: the Browse shell with this office's title, description and
// canonical link (see functions/_browse-page.js). Office pages list who held an office, from
// the facts model (docs/facts-model.md).
export const onRequestGet = browsePageHandler('offices');
