"""Write generated JSON the way the Node side does, and keep it deployable.

Generated files are indented, so their diffs are readable. A file whose indented text
would pass PAGES_SAFE_BYTES is written compact instead: Cloudflare Pages refuses files
over 25 MiB, and clean-for-pages.sh deletes them from the deploy, so an oversized
election bundle silently stops being served from the static path. Indentation is a third
of an election bundle (the 2004 RoI locals are 36 MB indented, 23 MB compact), so this
keeps those files deployable without changing a byte of their data.

scripts/lib/stable-generated-json.mjs applies the same rule; keep the two in step.
"""
import json
import time

# 24 MiB: a margin under Pages' 25 MiB per-file limit.
PAGES_SAFE_BYTES = 24 * 1024 * 1024


def generated_json_text(doc):
    text = json.dumps(doc, ensure_ascii=False, indent=2) + '\n'
    if len(text.encode('utf-8')) > PAGES_SAFE_BYTES:
        text = json.dumps(doc, ensure_ascii=False, separators=(',', ':')) + '\n'
    return text


def dump_generated_json(path, doc):
    # Windows Defender and the search indexer briefly lock a large JSON file just written,
    # and open() then fails with OSError [Errno 22]. The lock clears within seconds, so wait
    # and retry instead of failing a long re-stamp run on one file.
    text = generated_json_text(doc)
    for attempt in range(8):
        try:
            with open(path, 'w', encoding='utf-8', newline='\n') as fh:
                fh.write(text)
            return
        except OSError as error:
            if error.errno not in (13, 22) or attempt == 7:
                raise
            time.sleep(1 + attempt)
