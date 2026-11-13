"""Request headers for the Wikimedia projects: the Python twin of crawlHeaders(extra, { url })
in packages/config/src/node.mjs.

A request to a Wikimedia host (Wikipedia, Wikidata and its query service, Wikimedia Commons and
upload) carries the site's User-Agent; every other host gets no User-Agent from here, so the
library's own default applies. The crawl-headers unit test holds this file equal to node.mjs.

Load it without touching sys.path:

    _wm = runpy.run_path(os.path.join(REPO, 'scripts', 'ingest', 'wikimedia_headers.py'))
    req = urllib.request.Request(url, headers=_wm['wikimedia_headers'](url))
"""
from urllib.parse import urlsplit

# SITE.userAgent in packages/config/src/config.js (Python cannot import it).
WIKIMEDIA_UA = 'civgraph-research (+https://civgraph.net)'
WIKIMEDIA_DOMAINS = ('wikipedia.org', 'wikidata.org', 'wikimedia.org')


def is_wikimedia(url):
    """True when the URL's host is a Wikimedia domain or a subdomain of one."""
    try:
        host = (urlsplit(str(url)).hostname or '').lower().rstrip('.')
    except ValueError:
        return False
    return any(host == d or host.endswith('.' + d) for d in WIKIMEDIA_DOMAINS)


def wikimedia_headers(url, extra=None):
    """`extra` less any User-Agent, plus the site's User-Agent when `url` is on Wikimedia."""
    headers = {k: v for k, v in (extra or {}).items() if k.lower() != 'user-agent'}
    if is_wikimedia(url):
        headers['User-Agent'] = WIKIMEDIA_UA
    return headers
