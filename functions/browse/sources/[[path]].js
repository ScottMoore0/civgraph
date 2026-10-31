import { browsePageHandler } from '../../_browse-page.js';

// GET /browse/sources/<slug>: the Browse shell with this record's title, description and
// canonical link (see functions/_browse-page.js).
export const onRequestGet = browsePageHandler('sources');
