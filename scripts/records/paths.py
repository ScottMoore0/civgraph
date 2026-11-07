"""Where the record build writes, in one place (the Python twin of paths.mjs).

CIVGRAPH_BUILD_DIR unset: everything under tmp/records, where records:build puts it.
CIVGRAPH_BUILD_DIR=<dir>: everything under <dir>.
CIVGRAPH_BUILD_DIR=legacy: the old locations (render/metadata/elections-test2, ...).

Load it from any script without touching sys.path:

    import runpy, os
    _rp = runpy.run_path(os.path.join(REPO, 'scripts', 'records', 'paths.py'))
    META = _rp['ELECTION_BUNDLE_DIR']
"""
import os

DEFAULT_BUILD_DIR = 'tmp/records'
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def build_dir(env=None):
    env = os.environ if env is None else env
    value = (env.get('CIVGRAPH_BUILD_DIR') or '').strip() or DEFAULT_BUILD_DIR
    return None if value == 'legacy' else os.path.abspath(os.path.join(REPO_ROOT, value))


def record_paths(env=None):
    build = build_dir(env)

    def at(built, legacy):
        return os.path.join(build, built) if build else os.path.join(REPO_ROOT, *legacy.split('/'))

    return {
        'BUILD_DIR': build,
        'ELECTION_BUNDLE_DIR': at('elections', 'render/metadata/elections-test2'),
        'ELECTION_MANIFEST': at('elections-test2.json', 'render/metadata/elections-test2.json'),
        'ELECTION_REPORT': at('elections-test2-report.json', 'render/metadata/elections-test2-report.json'),
        'ELECTION_SUMMARY_DIR': at('elections-summaries', 'render/metadata/elections-test2-summaries'),
        'PROVENANCE_FILE': at('election-provenance.json', 'data/database/election-provenance.json'),
        'PROVENANCE_SHARD_DIR': at('election-provenance', 'render/metadata/election-provenance'),
        'BROWSE_DIR': at('browse', 'data/browse'),
        'GRAPH_DIR': at('graph', 'data/graph'),
        'RECORDS_DB': os.path.join(REPO_ROOT, 'tmp', 'records', 'civgraph-records.sqlite'),
    }


_P = record_paths()
BUILD_DIR = _P['BUILD_DIR']
ELECTION_BUNDLE_DIR = _P['ELECTION_BUNDLE_DIR']
ELECTION_MANIFEST = _P['ELECTION_MANIFEST']
ELECTION_REPORT = _P['ELECTION_REPORT']
ELECTION_SUMMARY_DIR = _P['ELECTION_SUMMARY_DIR']
PROVENANCE_FILE = _P['PROVENANCE_FILE']
PROVENANCE_SHARD_DIR = _P['PROVENANCE_SHARD_DIR']
BROWSE_DIR = _P['BROWSE_DIR']
GRAPH_DIR = _P['GRAPH_DIR']
RECORDS_DB = _P['RECORDS_DB']


def local_path_for_url(url, paths=None):
    """The file behind a public URL that the record build wrote (paths.mjs localPathForUrl).

    Returns None for a URL the record build does not produce: those are files in the tree.
    """
    paths = _P if paths is None else paths
    clean = str(url or '').split('?')[0].split('#')[0].lstrip('/')
    prefixes = [
        ('render/metadata/elections-test2.json', paths['ELECTION_MANIFEST'], True),
        ('render/metadata/elections-test2-report.json', paths['ELECTION_REPORT'], True),
        ('render/metadata/elections-test2-summaries/', paths['ELECTION_SUMMARY_DIR'], False),
        ('render/metadata/elections-test2/', paths['ELECTION_BUNDLE_DIR'], False),
        ('render/metadata/election-provenance/', paths['PROVENANCE_SHARD_DIR'], False),
        ('data/database/election-provenance.json', paths['PROVENANCE_FILE'], True),
        ('data/browse/', paths['BROWSE_DIR'], False),
        ('data/graph/', paths['GRAPH_DIR'], False),
    ]
    for prefix, target, exact in prefixes:
        if exact and clean == prefix:
            return target
        if not exact and clean.startswith(prefix):
            rest = clean[len(prefix):]
            if not rest or '..' in rest.split('/'):
                return None
            return os.path.join(target, *rest.split('/'))
    return None
