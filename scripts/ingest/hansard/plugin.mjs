// The Northern Ireland Parliamentary Debates (Hansard, 1921-72) OCR text: the clean-up pass.
import { definePlugin } from '@civgraph/intake/plugins.mjs';

export default definePlugin({
  id: 'hansard',
  title: 'Northern Ireland Parliamentary Debates OCR clean-up',
  kinds: ['sources'],
  personalData: { contains: false, handling: 'none' },
  sources: [{ id: 'ni-hansard', title: 'Parliamentary Debates, House of Commons and Senate of Northern Ireland, 1921-1972', publisher: 'HMSO Belfast', rights: 'facts-with-citation' }],
  inputs: { textDir: { description: 'folder of OCR .txt files to clean in place (inside the repository for a batch to capture them)' } },
  steps: {
    clean: { title: 'Clean the OCR text files in a folder in place', argv: ['python', 'scripts/ingest/hansard/clean_hansard_ocr.py', '{input:textDir}'] },
  },
});
