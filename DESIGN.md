---
name: ShredSafe
description: Posts file-disposal risk the way safety signs post hazards, inside a navy advisor-portal shell.
colors:
  portal-navy: "#0e2841"
  portal-navy-hover: "#1a3d61"
  rail-hover: "#17375a"
  rail-ink-muted: "#b4c2d3"
  ground: "#ffffff"
  layer: "#f2f3f4"
  layer-strong: "#e4e6e8"
  ink: "#111214"
  ink-secondary: "#4a4f57"
  rule: "#d4d7db"
  danger-red: "#c8102e"
  danger-wash: "#fbe9ec"
  notice-blue: "#0057b8"
  safe-green: "#007a4d"
  warning-orange: "#e87722"
  warning-text: "#b5520c"
  caution-yellow: "#ffd100"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  statement:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.15
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.1
  signal-word:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.04em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 700
    lineHeight: 1.5
rounded:
  none: "0px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "24px"
  lg: "32px"
  page-x: "48px"
components:
  button:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "7px 16px"
    height: "38px"
  button-hover:
    backgroundColor: "{colors.layer}"
  button-primary:
    backgroundColor: "{colors.portal-navy}"
    textColor: "{colors.ground}"
    rounded: "{rounded.none}"
    padding: "7px 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.portal-navy-hover}"
  button-small:
    padding: "4px 12px"
    height: "32px"
  chip-solid:
    backgroundColor: "{colors.portal-navy}"
    textColor: "{colors.ground}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "2px 8px 2px 6px"
  chip-danger:
    backgroundColor: "{colors.danger-red}"
    textColor: "{colors.ground}"
    rounded: "{rounded.none}"
    padding: "2px 8px 2px 6px"
  chip-notice:
    backgroundColor: "{colors.notice-blue}"
    textColor: "{colors.ground}"
    rounded: "{rounded.none}"
    padding: "2px 8px 2px 6px"
  sign-band-danger:
    backgroundColor: "{colors.danger-red}"
    textColor: "{colors.ground}"
    typography: "{typography.signal-word}"
    padding: "5px 12px"
  sign-band-safe:
    backgroundColor: "{colors.safe-green}"
    textColor: "{colors.ground}"
    typography: "{typography.signal-word}"
    padding: "5px 12px"
  sign-band-notice:
    backgroundColor: "{colors.notice-blue}"
    textColor: "{colors.ground}"
    typography: "{typography.signal-word}"
    padding: "5px 12px"
  sign-band-warning:
    backgroundColor: "{colors.warning-orange}"
    textColor: "{colors.ink}"
    typography: "{typography.signal-word}"
    padding: "5px 12px"
  nav-item:
    textColor: "{colors.rail-ink-muted}"
    padding: "11px 24px"
  nav-item-hover:
    backgroundColor: "{colors.rail-hover}"
    textColor: "{colors.ground}"
  nav-item-active:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.portal-navy}"
---

# Design System: ShredSafe

## Overview

**Creative North Star: "The Posted Sign"**

Risk is posted the way hazards are posted: an ANSI Z535-style sign, a coloured signal-word band with a drawn symbol over a plain white message panel, so a legal hold reads from across a projector room. Everything around the signs stays quiet. The shell is a navy rail close to the LPL advisor portal the product lives inside; the working surface is true white with near-black ink, square corners and 2px rules.

The system is strict about what colour means. Red, blue and green appear only on states that actually carry that meaning (legal hold or a failed integrity check, needs review or focus, verified or nothing protected deleted). Ordinary decisions and ordering signals (DELETE, HIGH EXPOSURE, the selected tab, the primary button, the "Up N" moved marker) wear portal navy. Exposure, which only sets the order rows appear in, is a navy three-segment meter with a HIGH/MEDIUM/LOW word and a numeric score, never a safety colour. Wording is plain compliance language ("LEGAL HOLD", "INTEGRITY CHECK PASSED", "NO PROTECTED FILES DELETED"), not alarm.

Density is that of a working table: 64px rows, a condensed grotesk for anything that has to be read at a glance, and a workhorse sans with tabular figures for everything else.

**Key Characteristics:**
- Navy rail shell, white ground, near-black ink, square corners everywhere.
- Safety colours live only in sign bands, chips and state marks that carry that exact meaning.
- Signal words and headings in Barlow Condensed; body and data in Barlow with tabular figures.
- Drawn SVG symbols (alert triangle, check disc, info disc), never glyphs.
- 2px ink rules frame structure; 1px grey rules separate rows.
- Flat surfaces. Shadow only on floating layers (toast, sticky bulk bar).

## Colors

A navy-and-ink working palette with a reserved set of flat enamel safety colours.

### Primary
- **Portal Navy** (portal-navy): the rail background, the primary button, the selected-tab underline and count, solid chips (DELETE, LOCKED RECORD, HIGH EXPOSURE), the exposure meter, the moved marker, checkbox accent, scan progress, and the "will delete" segment of the dashboard breakdown. Hover deepens to Portal Navy Hover on buttons and Rail Hover on rail links.
- **Rail Ink Muted** (rail-ink-muted): inactive nav labels and secondary text on the rail.

### Secondary (safety colours, meaning-bound)
- **Danger Red** (danger-red): legal hold (sign, chip, held-file count), a failed integrity check, a broken audit-chain link, protected files deleted, failed uploads, error toasts. Danger Wash (danger-wash) tints the broken chain row.
- **Notice Blue** (notice-blue): NEEDS REVIEW, informational notices (dashboard fallback), the focus ring, caret, and link-hover underline.
- **Safe Green** (safe-green): INTEGRITY CHECK PASSED, NO PROTECTED FILES DELETED, completed uploads, removed files in the breakdown, success toasts.
- **Warning Orange** (warning-orange): the band of warning signs that report a failed request or API error. As text on white it shifts to Warning Text (warning-text) for contrast.
- **Caution Yellow** (caution-yellow): only as a 14% wash on the upload drop target while files are dragged over it.

### Neutral
- **Ground** (ground): page and panel background; text on navy and on red/blue/green bands.
- **Layer** (layer): expanded details panel, selected row, secondary-button hover, tab counts, skeletons.
- **Layer Strong** (layer-strong): progress tracks and disabled primary buttons.
- **Ink** (ink): body text, 2px structural rules, button borders, toasts.
- **Ink Secondary** (ink-secondary): supporting text, column heads, metadata (8.3:1 on white).
- **Rule** (rule): 1px row separators, disabled borders, the hairline that isolates Approve.

### Named Rules
**The Earned Colour Rule.** A safety colour appears only where its meaning is literally true: red for something that must not or did not go right, blue for review and focus, green for verified. Anything that merely ranks or recommends is navy.

**The Exposure Is Not Danger Rule.** Exposure sets order, not permission. Show it as the navy three-segment meter plus the HIGH/MEDIUM/LOW word and score; never colour it red, orange or yellow.

**The Never By Colour Alone Rule.** Every coloured state carries a word (signal word or chip label) and, on signs and safety chips, a drawn symbol.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow, sans-serif), weights 600/700/800
**Body Font:** Barlow (with system-ui, sans-serif), weights 400/500/600/700

**Character:** A bold condensed grotesk for signal words and headings, the face of posted signage; a plain humanist workhorse for reading and data. Tabular figures are on globally.

### Hierarchy
- **Display** (800, 2.5rem, 1.1; 2rem below 860px): page titles.
- **Statement** (600 with 800 for emphasised figures, 2.25rem, 1.15, max 24ch): the dashboard's lead sentence.
- **Headline** (700, 1.375rem, 1.1): section heads.
- **Signal word** (800, 1.15rem, 0.04em tracking, uppercase copy): sign bands; 0.95rem in compact signs, 1.5rem on the audit seal. Chips use the same face at 700, 0.92rem, 0.03em.
- **Title** (700, 1rem): sub-heads such as "Why this recommendation". Rail nav uses the condensed face at 700, 1.15rem; large figures (summary counts, measures) at 800, 1.6 to 1.75rem.
- **Body** (400, 1rem, 1.5; supporting paragraphs capped at 64ch): all running text and table cells.
- **Label** (700, 0.82rem): table column heads and counts, in Ink Secondary, sentence case.

### Named Rules
**The Condensed Means Read-At-A-Glance Rule.** Barlow Condensed is for things a judge must read across a room: titles, signal words, chips, nav, headline figures. Paragraphs and data stay in Barlow.

## Layout

A two-column shell: a 240px sticky navy rail (brand, nav with counts, advisor and data-source switch at the foot) and a fluid main column padded 36px 48px 72px. The rail colour is painted full-height on the shell so long pages never show it ending. Each page opens with a header (title plus one-line instruction left, the page's main control right) closed by a 2px ink rule.

The review queue is a six-column grid (checkbox 32px, exposure 150px, file, recommendation 150px, keep-until 124px, actions 190px) with 14px gaps and 64px minimum rows. Signs and details for a row indent to align under the file column (210px). Spacing works in steps of roughly 8, 14, 24 and 32px.

Responsive: at 1180px the keep-until column drops; at 860px the rail becomes a top bar with a horizontally scrolling nav strip and main padding drops to 24px 16px; at 760px rows restack into check / file / risk + recommendation / actions areas and file names wrap in full.

## Elevation & Depth

Flat by default. Structure comes from 2px ink rules, 1px grey separators and the Layer tint, not from shadow. Only two floating layers carry a soft ambient shadow: toasts and the sticky bulk-approve bar.

### Shadow Vocabulary
- **Toast** (`box-shadow: 0 8px 24px rgb(0 0 0 / 0.22)`): bottom-right toasts on ink.
- **Bulk bar** (`box-shadow: 0 10px 28px rgb(0 0 0 / 0.16)`): the sticky selection bar that floats over the table.

### Named Rules
**The Floating-Only Shadow Rule.** A shadow means the element floats above the page and will go away. Panels, rows, signs and buttons never cast one.

## Shapes

Square corners everywhere (0px radius): buttons, chips, signs, panels, nav, tabs, meter segments and chain nodes. Borders are the form language: 2px ink for buttons, panels and signs (signs use pure black), 3px for the upload drop zone (dashed at rest, solid on drag-over) and audit chain nodes, 1px Rule between rows. The audit chain is a 3px vertical line through square nodes; a broken link snaps the joint short and turns red, untrusted links after it go dashed grey.

## Components

### Buttons
Rectangular and plain; the decision is the content.
- **Shape:** square (0px), 2px border, 38px minimum height (32px small).
- **Default:** white with ink border and ink text, weight 600, 0.92rem; used for Keep and secondary actions.
- **Primary:** Portal Navy fill and border with white text; used for Approve and the page's main action.
- **Hover / Focus / Active:** default goes to Layer, primary to Portal Navy Hover, 150ms ease-out; press nudges 1px down; focus is a 3px Notice Blue outline offset 2px.
- **Quiet:** borderless underlined text, underline turns blue on hover.
- **Disabled:** Rule border, grey text, not-allowed cursor.

### Chips
A sign reduced to its band.
- **Style:** condensed 700, square, 2px border slot; safety chips (danger, notice) carry a 14px drawn symbol.
- **Variants:** solid navy (DELETE, LOCKED RECORD, HIGH EXPOSURE), danger (LEGAL HOLD), notice (NEEDS REVIEW), plain ink outline (RETAIN, Kept by you), ghost dashed grey (Not scanned, In grace period, Purged, Classifying).

### Cards / Containers
- **Corner Style:** square.
- **Background:** Ground for panels (2px ink border); Layer for the expanded details grid and rehearsal strip (no border).
- **Shadow Strategy:** none (see Elevation & Depth).
- **Internal Padding:** 16px 18px for details; 16px for lists.

### Inputs / Fields
- **Checkboxes:** native, 18px, Portal Navy accent; disabled at 30% opacity for rows that cannot be approved.
- **Data-source switch:** a two-segment 2px white-bordered toggle on the rail; pressed segment is white with navy text.
- **Upload drop zone:** 3px dashed ink border, centred condensed title, outlined folder icon; on drag-over the border goes solid with a Caution Yellow wash.

### Navigation
Rail links in Barlow Condensed 700, 1.15rem, Rail Ink Muted; hover brightens to white over Rail Hover; the active page is a white block with navy text. Counts are small white blocks that invert on the active link. Below 860px the nav becomes a horizontally scrolling strip. Page tabs (queue) use a 4px bottom bar, navy when selected, with a count block that fills navy.

### Sign (signature component)
The ANSI Z535 format: a 2px black frame, a signal-word band (condensed 800, uppercase, drawn symbol at 20px) over a white message panel. Danger and warning bands use the alert triangle (black triangle with coloured mark on light bands); safe uses the check disc; notice uses the info disc. The signal word can be replaced with a plain compliance phrase ("LEGAL HOLD", "INTEGRITY CHECK FAILED"). Compact signs sit inline (held rows, page errors); the audit seal enlarges the band to 1.5rem. Max width 76ch unless placed in a grid.

### Exposure Meter
Three 6 x 14px navy-outlined segments, filled for HIGH (3), MEDIUM (2) and LOW (1), followed by the level word in condensed 700 and the numeric score in small Ink Secondary.

### Moved Marker
"Up N" in a 2px navy outline box (0.75rem, 700) beside the exposure, meaning the row moved up N places after the scan; it stays until the advisor hovers or focuses the row, and a one-line legend above the table explains it.

### Audit Chain
A vertical chain of 32px square numbered nodes on a 3px ink line, each row 64px with action, file, metadata and hashes. A broken link turns red with a Danger Wash row, filled red node and a snapped joint; links after it are dashed grey and muted.

## Do's and Don'ts

### Do:
- **Do** use Portal Navy for every ordinary decision, ranking and primary action.
- **Do** reserve red for legal hold, failed integrity, broken chain and protected-file deletion; blue for needs-review, notices and focus; green for verified outcomes.
- **Do** pair every coloured state with a word, and on signs and safety chips with a drawn SVG symbol.
- **Do** use plain compliance wording in sign bands ("LEGAL HOLD", "INTEGRITY CHECK PASSED", "NO PROTECTED FILES DELETED").
- **Do** keep Approve visually isolated from Keep (22px gap with a 1px Rule divider).
- **Do** keep corners square and structure on 2px ink rules.
- **Do** honour prefers-reduced-motion; transitions are 150ms ease-out (cubic-bezier(0.16, 1, 0.3, 1)).

### Don't:
- **Don't** colour exposure, recommendations or tabs with safety colours.
- **Don't** use rounded corners, gradient accents or rows of identical stat tiles.
- **Don't** put a shadow on anything that doesn't float.
- **Don't** use alarmist wording or a safety colour as decoration.
- **Don't** use emoji or font glyphs for the alert, check or info symbols; draw them.
