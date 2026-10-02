---
version: 1
slug: "frontend-src-app-tsx"
primary_target: "frontend/src/App.tsx"
related_targets: ["frontend/src/pages"]
---

# ShredSafe advisor app (all four screens)

Mode: Operate. Advisor reviews disposal recommendations, approves deletions, checks proof. Secondary audience: hackathon judges on a projector.
Constraints: keep all existing behavior, copy facts, mock/live API switch. WCAG AA; risk never by colour alone.
Memorable moment: the legal-hold file posted as a red DANGER sign; the audit chain breaking.

## Direction contract

THESIS: Risk is posted the way hazards are posted (ANSI Z535 signal words), so a judge reads danger from across the room. Refuses the SaaS badge-pill table and stat-tile dashboard.

OWN-WORLD: Black rail and ink, true-white ground, flat enamel safety colours (red DANGER, orange WARNING, yellow CAUTION, blue NOTICE, green SAFE) used only inside sign panels: a signal-word band with the alert triangle over a plain message. Bold condensed grotesk for signal words and headings, a workhorse sans for everything else, tabular figures. Square corners, 2px black rules.

STORY: The advisor sees what's dangerous, what's safe to clear, and approves with confidence; then sees proof.

FIRST VIEWPORT: Black left rail (nav, advisor, data source). Review queue: heading + one-line instruction, scan control right. Summary as three signs (ready / held / review). Table: risk sign-chip, file, recommendation, keep-until, actions with Approve isolated from Keep. Held row carries a full red DO NOT DESTROY sign.

FORM: Safety Sign Standard, candidate 3 of 7, seed b672d11d. Raises: moved rows stay marked until seen (gate board); Approve isolated (console); colour only in signs (lexicon).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
