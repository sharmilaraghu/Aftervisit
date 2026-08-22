@AGENTS.md

# CLAUDE.md

Everything that governs this project lives in **AGENTS.md**, imported above, so that Cursor
and Codex read exactly the same rules Claude does. Only Claude-specific wiring is here.

## UI/UX workflow

Treat every visible change as design work, not markup. Read **DESIGN.md** first — once
`impeccable` has written it, it is the standard, and `app/globals.css` is the source of
truth it documents.

1. **`impeccable`** owns the design direction. The console's visitor mode is `Operate`; the
   landing page is `Persuade`, and it is a separate surface with its own brief.
2. **`/design-review`** after any visible change — desktop *and* narrow framings.
3. Stay inside the tokens in `app/globals.css`. Reuse the existing `Badge`, `Button`,
   `Panel`, `TopBar`. A new one-off button is a bug.
4. Red means danger only — escalations, guard violations, live dialing. One accent per view.
   Numbers in mono. Phone numbers masked, always: this UI ends up in a published video.
5. No AI-slop tells: gradient blobs, glassmorphism everywhere, lavender/indigo,
   centered-everything, emoji headings, lorem copy.

## Agents

| Agent | When |
|---|---|
| `careloop-reviewer` | Any edit under `lib/calle/`, `lib/script/`, `lib/rules/`, `lib/schedule/`, `lib/plan/`, `lib/phone/` — catches silent drift in the guard, the port, the dial allowlist, consent text, idempotency, or the purity of the rule engine |
| `code-reviewer` | After writing or changing other code — correctness, Next 16 conventions, dead code, matching existing style |
| `docs-lookup` | Next 16 / Drizzle / CALL-E / OpenAI questions — local docs first, then Context7 |

## Slash commands

| Command | Purpose |
|---|---|
| `/verify` | Run the gate (`test`, `typecheck`, `lint`) and report honestly |
| `/review [scope]` | Review recent changes, routed to the right reviewer |
| `/commit [hint]` | Stage and commit — identity assertion, then a secret / phone / PHI scan |
| `/feature <desc>` | Plan → implement → verify → review → commit, hackathon-scoped |

## Skills

| Skill | Purpose |
|---|---|
| `start-app` | Boot the dev server via `./start.sh` (frees the port, shows the dial banner) |
| `design-review` | Designer's-eye audit of the console against DESIGN.md |
