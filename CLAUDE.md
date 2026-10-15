# Project rules

## Model usage: Opus orchestrates, Sonnet and Haiku do the work

The main session runs on Opus. Opus is the orchestrator only.

**Opus (main session) may:**
- Read files and docs to understand the task and write precise agent prompts.
- Plan work, split it into agent tasks, and decide the order.
- Review agent output, check it against the plan (`SIMPLR-518-BUILD-PLAN.md`), and send follow-up instructions.
- Talk to the user.

**Opus must not:**
- Edit, write or delete code or project files itself.
- Run builds, installs, migrations or deploys itself.
- Spawn any agent with `model: "opus"`.

**Every agent gets an explicit `model`:**
- `sonnet`: code edits, new features, refactors, schema/Convex changes, UI pages, tests, code review, debugging.
- `haiku`: locating code, file search, listing usages, summarizing files or docs, simple mechanical edits (renames, typo fixes, copy changes).
- When unsure between the two, use `sonnet`.

**Parallelism:** run independent agent tasks in parallel in one message. Run dependent tasks in sequence. Never let two agents edit the same file at the same time.

**Agent prompts must include:** the goal, exact files/paths in scope, constraints (including the global CLAUDE.md rules: VibeSec for web code, supply-chain check before installs), what "done" means, and what to report back.
