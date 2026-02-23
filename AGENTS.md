## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Recurring Issue Prevention
- You must identify recurring defects (same/similar bug appearing multiple times).
- You must log each recurring issue in `tasks/todo.md` with:
  - symptom
  - root cause
  - permanent prevention action
  - verification evidence
- After each recurrence, add or tighten at least one guardrail:
  - automated check/test/lint rule, or
  - central utility abstraction that removes duplicated fragile logic.
- Do not close recurring issues until the preventative guardrail is implemented and verified.

# AGENTS Instructions

## Track Tasks in tasks/todo.md
You must track any and all tasks you have to do in `tasks/todo.md`, including:
- The title of each task
- What each task consists of
- Whether it is completed yet
- If completed, what you did in order to complete it

## Mandatory ZIP Intake Check
- Perform ZIP intake check at most once per 24 hours.
- If a ZIP intake check has already been performed, DO NOT run it again until 24 hours have elapsed.
- Run the check only when current UTC time is at or after the recorded `next_check_after_utc` time.
- On each check, inspect whether `maps-to-be-added` contains any `.zip` files that include:
  - one or more map files, and
  - a text/markdown document containing some or all of:
    - Map name
    - Map provider
    - Map date / year
    - License (if known)
    - Methodological notes (provider verbatim or production notes)
    - Category card on website (existing or new)
    - Outline colour hex
    - Fill colour hex
    - Custom styling (if necessary)
    - Attribute to use for feature labels
- If any such zip files exist, you MUST bring this to the user's attention and ask if they want to add these maps to the website.
- Tracking is mandatory via `.zip-intake-check.json` at repo root.
- After each check, update `.zip-intake-check.json` with:
  - `last_checked_utc`
  - `next_check_after_utc` (`last_checked_utc` + 24h)
  - `checked_by`
  - `notes`
- Between checks, read `.zip-intake-check.json` and skip the ZIP intake step if current time is before `next_check_after_utc`.
