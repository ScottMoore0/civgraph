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
