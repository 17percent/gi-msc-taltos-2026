# Engineering skills — when to use (all fleet agents)

Source: Matt Pocock, *Skills For Real Engineers* (Claude Code plugin from the Anthropic Directory; plugin skills may show a
prefix such as `<plugin>:grilling`; other agents incl. GitHub Copilot get them with `npx skills` into a project or user
`.agents/skills/` folder; the original version of this fleet used them as `mp-grilling` etc.). **If a skill is available in your
environment, use it in the situation below. If it is not (not installed, or a fleet specialist without a skill tool), apply the
principle yourself: the principle is the point, not the tool.** The fleet's own skills (`.claude/fleet/skills/`, e.g.
test-driven-development, verification-before-completion) come first; these do not replace them.

| Situation | Skill | Principle without the skill |
|---|---|---|
| Short brief, no acceptance criteria, or you are about to write assumptions into a plan or code | `grilling` (BEFORE delegating or implementing, not after) | List the open decisions that change the outcome and ASK THE OWNER for each (see "Asking the owner" below); never pick the recommended option yourself. Record the owner's answers under DECISIONS. What the repo can answer, read instead of asking. |
| Finalising a plan or decision | `grilling` | Same: ask the owner, then log the owner's decisions in the result. |
| Bug report without reproduction, recurring or hard bug | `diagnosing-bugs` | Build a tight feedback loop first (failing test or repro script), theory second; report the repro under EVIDENCE. |
| A design question needs runnable evidence | `prototype` | Smallest throw-away spike that answers the question; report the finding, do not ship the spike. |
| Module shape, boundaries, interfaces | `codebase-design` | Deep modules, small interfaces, hide decisions likely to change. |
| Vocabulary, naming, architecture decisions | `domain-modeling` | Use the domain's terms consistently; record decisions as ADRs. |
| Turning a discussion into a spec | `to-spec` | Write goal, scope, non-goals, acceptance criteria, open questions. (User-invocable only: an agent cannot call it; suggest `/to-spec` to the owner or apply the principle.) |
| Unsure which skill or specialist fits | `ask-matt` | Name the situation, the fitting skill and the owning specialist under NEXT ACTION. |

## Asking the owner (grilling): real questions, no silent defaults

- **Who asks:** the orchestrator (main session) asks, BEFORE delegating or implementing. In Claude Code use the interactive question tool (`AskUserQuestion`): one question per decision, 2-4 options, up to 4 independent questions per call, `multiSelect` when answers can combine; free text ("Other") is always available. In GitHub Copilot ask in the chat and stop until the owner answers. An automatic reply such as "the user is not available ... work autonomously" is not an answer: do not act on what it would decide, report it as an open question.
- **A recommended answer is a suggestion, never the default.** Whether it comes from the plugin skill or from you: show it as the first option, labelled "(Recommended)" with the reason in its description, but never treat it as chosen, never continue on it, and never write it into a plan, packet or code as a decision without the owner's reply. Only an explicit owner statement such as "use your recommendations" turns recommendations into decisions (log it as exactly that).
- **Explore first.** Do not ask what the repo, code, docs or earlier decisions already answer. Ask only decisions that change scope, behaviour, data, security or cost.
- **Order:** independent decisions together in one call; dependent ones one after the other, each after the previous answer.
- **Specialists cannot ask the owner** (one-shot, no question tool). For an outcome-changing decision that the packet and the repo do not settle, do NOT silently take the recommended option: finish with STATUS PARTIAL or BLOCKED and list the questions under OPEN QUESTIONS, each with its options (a recommendation may be marked as a suggestion). The orchestrator then asks the owner and re-dispatches (`SendMessage` in Claude Code). Outcome-neutral gaps: state the assumption under RISKS.
- **Every question-asking skill follows this** (`grilling`, `to-spec`, `diagnosing-bugs`, `prototype`, `domain-modeling`): their questions go to the owner through the orchestrator; the model never answers them on its own.

Never automatic, whatever a skill recommends (stop, report under NEXT ACTION): irreversible or destructive steps, anything
external (publish, deploy, email), secrets or personal data, spending money, weakening a security gate, or a conflict with
an ADR or an owner instruction.
