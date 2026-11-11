# Project rules

## Model usage: Opus orchestrates, agents do the work (model chosen by task complexity)

The main session runs on Opus. Opus is the orchestrator only.

**Opus (main session) may:**
- Read files and docs to understand the task and write precise agent prompts.
- Plan work, split it into agent tasks, and decide the order.
- Review agent output, check it against the plan (`SIMPLR-518-BUILD-PLAN.md`) and the client docs (`docs/context/`), and send follow-up instructions.
- Talk to the user.

**Opus must not:**
- Edit, write or delete code or project files itself.
- Run builds, installs, migrations or deploys itself.

**Every agent gets an explicit `model`, chosen by task complexity (the more complex the task, the stronger the model):**
- `opus`: complex or high-stakes work. Multi-file features or refactors that span backend and UI; schema design, data migrations and importers; authorization, permissions and security work; hard debugging; Sarah prompt, flow and emergency/legal wording design; polished client-facing deliverables (Word, PDF, slide decks); anything where a mistake is costly or hard to undo.
- `sonnet`: standard work. Single-feature code edits, UI pages, Convex functions with clear specs, tests, code review, routine debugging, research and audits.
- `haiku`: simple work. Locating code, file search, listing usages, summarizing files or docs, simple mechanical edits (renames, typo fixes, copy changes).
- When unsure between two tiers, use the higher one.

**Parallelism:** run independent agent tasks in parallel in one message. Run dependent tasks in sequence. Never let two agents edit the same file at the same time.

**Agent prompts must include:** the goal, exact files/paths in scope, constraints (including the global CLAUDE.md rules: VibeSec for web code, supply-chain check before installs), what "done" means, and what to report back.
