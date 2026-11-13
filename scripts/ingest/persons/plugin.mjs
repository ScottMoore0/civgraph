// Person ids: the registry, the stamp on every candidacy, the merge loop, the name layer and the
// audit. `rebuild` is the whole loop in its documented order (rebuild-person-ids.mjs, an explicit
// state machine); the other steps are its parts, for a single re-run.
import { DEFAULT_BUILD_DIR } from '../../../packages/config/src/node.mjs';
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

export default definePlugin({
  id: 'persons',
  title: 'Person ids and the name registry',
  kinds: ['persons'],
  personalData: { contains: true, handling: 'names-only', note: 'Candidate names and the ids that join them; no addresses.' },
  sources: [
    { id: 'civgraph-elections', title: "Civgraph's election data (data/elections-source)", rights: 'facts-with-citation' },
    { id: 'electionsireland-ids', title: 'ElectionsIreland.org candidate ids and relatives pages', publisher: 'ElectionsIreland.org', url: 'https://electionsireland.org/', rights: 'facts-with-citation' },
  ],
  steps: {
    rebuild: {
      title: 'The whole loop: manifest, summaries, registry, apply, merge passes, name registry, audit (exit 2: relatives harvest needed)',
      argv: ['node', 'scripts/ingest/persons/rebuild-person-ids.mjs'],
      // The records build (tmp/records, the default build folder) and the legacy folders it once used.
      outputs: ['render/metadata/elections-test2.json', 'render/metadata/elections-test2/', `${DEFAULT_BUILD_DIR}/elections-test2.json`, `${DEFAULT_BUILD_DIR}/elections/`, `${DEFAULT_BUILD_DIR}/elections-summaries/`, 'tmp/person-lifespan-apply.csv', 'tmp/person-lifespan-veto.csv'],
      note: 'Heavy: the full election manifest. The main session runs it when landing.',
    },
    registry: { title: 'Build data/elections/persons/person_registry.json', argv: ['python', 'scripts/ingest/persons/build_person_registry_v2.py', '--force'] },
    // apply, merge and name-registry rewrite the election bundle of the records build in place.
    apply: { title: 'Stamp personId on every candidacy from the registry', argv: ['python', 'scripts/ingest/persons/apply_person_ids_v2.py'], outputs: [`${DEFAULT_BUILD_DIR}/elections/`, 'tmp/person-lifespan-apply.csv'] },
    merge: { title: 'Merge the safe classes of split person ids', argv: ['python', 'scripts/ingest/persons/merge_person_ids.py'], outputs: [`${DEFAULT_BUILD_DIR}/elections/`] },
    'name-registry': { title: 'Build the name layer and stamp name_id', argv: ['python', 'scripts/ingest/persons/build_name_registry.py'], outputs: [`${DEFAULT_BUILD_DIR}/elections/`] },
    audit: { title: 'List person ids that are probably wrong', argv: ['python', 'scripts/ingest/persons/audit_person_ids.py'] },
    'find-split': { title: 'Find people split across two ids, from Wikipedia biographies', argv: ['python', 'scripts/ingest/persons/find_split_persons.py'], network: true },
  },
  helpers: ['build_ie_ei_crosswalk.py', 'display_names.py', 'ei_relatives.py', 'generated_json.py', 'person_id_issued.py', 'person_lifespans.py', 'rebuild-person-ids.sh', 'rekey-wikidata-persons.mjs'],
  data: ['person_registry.json'],
});
