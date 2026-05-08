# Project instructions — civgraph.net

## Token discipline (apply always)

Source: `token-discipline-guide.md` at repo root (gitignored, local reference).
Calibrated 2026-05-08. The rules below are the operational summary — read the
guide for rationale, examples, and Flash invocation details.

### 1. Pipe noisy Bash output

Anything beyond a trivial `echo`/`pwd` should be piped to a slice that answers
the question. Defaults:

- `npm install 2>&1 | tail -5` (or `--silent`)
- test/build runs: `... 2>&1 | tail -15`
- `git log --oneline -20` (never bare `git log`)
- `... 2>&1 | grep -E "error|warning"` for compile output

If you can't predict a useful slice, capture to a tmp file and `tail` it. Never
let an unfiltered multi-thousand-line dump land in context.

### 2. Grep before Read; Read with `offset`+`limit`

For any file >2000 lines, do **not** call `Read` without `offset`+`limit`
unless you genuinely need the whole file (rare). Standard pattern:

1. `Grep` for the symbol/keyword with `-n` to get a line number.
2. `Read` with `offset=<line-30>` and `limit=60–100`.

Files in this repo where this matters most: `js/ui-controller.js`,
`js/stages2.js`, `data/database/maps.json`. Do not reflexively re-read these
end-to-end — locate the section first.

### 3. Trust gate / build verdicts within a logical step

After a build, test, or script run reports success, treat the verdict as a
fact for the rest of that logical step. Do not re-run "to be sure" or re-read
the captured output. Only re-run when concrete new evidence (a later failure,
a baseline that may have masked a regression) requires it.

This applies to local build scripts, R2 upload scripts, `node scripts/bundle.mjs`,
etc. — each successful run counts once.

### 4. Delegate >5k-token reads to Flash

When you would otherwise read a chunk >5k tokens (an agent transcript, a long
log, a survey of many small files), delegate the read+summary to Deepseek V4
Flash via the OpenCode Go wrapper at:

```
C:/Users/scomo/bin/flash-delegate.sh <prompt-file>
# or
echo "..." | C:/Users/scomo/bin/flash-delegate.sh -
```

Output lands at `/tmp/flash-out-<ts>.txt`. **Pre-aggregate** files into the
prompt (`{ for f in ...; do echo "=== $f ==="; cat "$f"; done } | flash-delegate.sh -`)
rather than asking Flash to glob+read — Flash's tool loop is slow on many
small files but its 1M context handles big concatenated prompts well.

**Do not** delegate to Flash:
- Translator/emitter-style multi-step reasoning where instruction fidelity
  matters (Sonnet/Opus retain the edge).
- Anything where wrong output is hard to detect downstream (e.g., authoring
  tests against a translated dataset where you'd have to trust the result).
- Gate runs, commits, pushes — those stay Sonnet/Opus-side.

**Do not** pass `--dir` to opencode invocations — Flash with `--dir` can write
files into the repo. Use the wrapper, which returns output via stdout only.

**Do not** background-with-redirect (`opencode ... > out &`) — the harness's
stdout capture races with the redirect and the file ends up empty. Foreground
only, via the wrapper.

### Decision order before reading any chunk

1. Can it be skipped? (Trust the verdict, drop the re-confirm.)
2. Can it be narrowed with grep first? Then `Read` offset+limit.
3. Is it Bash output? Pipe to `head`/`tail`/`grep`.
4. >5k tokens AND a summary suffices? Delegate to Flash.
5. Otherwise read directly (rare).

### Anti-patterns to avoid

- Reading whole large files reflexively.
- Re-running gates after each tiny change.
- Spawning subagents for tasks doable in 3 tool calls (subagents have their
  own context overhead).
- Reading tool output that's just `OK` / `done` — the exit code already said so.
- Asking Flash to "read these N files" via tool loop — pre-aggregate via shell.
- Accepting API keys in chat for Flash — auth lives in
  `~/.local/share/opencode/auth.json`, never in chat.
