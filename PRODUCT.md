# Product

## Register

product

## Users

Independent financial advisors affiliated with LPL, working from their own branch office on a desktop browser inside the advisor portal. They are not compliance experts. They have years of files on their drives and are afraid that deleting the wrong one breaks a rule. The job: clean out files they're no longer required to keep, without getting in trouble.

Secondary audience during the hackathon: judges watching a 5-minute live demo on a projector. They need to grasp each moment (risky file jumps to the top, legal-hold file blocked, audit chain breaks) from across the room.

## Product Purpose

ShredSafe finds files an advisor no longer has to keep, proves each one is safe to delete, deletes it after a human approves, and leaves a tamper-evident record a regulator can check. Success: an advisor approves a batch of deletions confidently, nothing under legal hold or still in retention is ever deleted, and the audit trail verifies.

## Brand Personality

Bold, decisive, trustworthy. The interface should feel like it has a point of view: deletion is safe here because the system shows its reasoning. Memorable enough that judges remember the demo, but every bold choice must carry meaning (risk, hold, proof), never decoration. Voice is plain and direct: says what happened and what to do, no hedging, no cheerleading.

## Anti-references

- Generic SaaS dashboard: rounded cards everywhere, gradient accents, rows of identical stat tiles.
- Dark "hacker" security tool: black background, neon green, terminal styling.
- Old enterprise software: cluttered grey bank back-office portal, dense tables with no hierarchy.

## Design Principles

1. Show the reasoning. Every recommendation carries its "why" (rule, citation, confidence) one interaction away.
2. Danger is legible at a glance. Legal holds and high-risk files must read from across a room.
3. Proof is the product. The audit chain and certificate are the climax, not a settings page.
4. Safe by default. Destructive actions are reversible (grace period) and blocked when not allowed; the UI never invites a mistake.
5. Bold in one place per screen. Each screen has one memorable element; everything around it stays disciplined.

## Accessibility & Inclusion

WCAG 2.2 AA: 4.5:1 body contrast, full keyboard operation with visible focus, `prefers-reduced-motion` honored for every animation, and risk/hold states never conveyed by color alone (always paired with text or shape).
