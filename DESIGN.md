---
name: Care Loop
description: A clinical follow-up agent, dressed as the dispensing label its plans behave like.
colors:
  bench: "#1c1a18"
  bench-2: "#262320"
  bench-3: "#322e2a"
  bench-line: "#3d3833"
  bench-line-strong: "#6b635a"
  bench-ink: "#f6f3ed"
  bench-ink-2: "#b8b2a6"
  bench-ink-3: "#8d867a"
  label: "#ffffff"
  label-2: "#f3f2ee"
  label-3: "#e7e5df"
  print: "#141310"
  print-2: "#43413c"
  print-3: "#6d6a63"
  rule: "#d8d5cd"
  rule-2: "#ebe9e3"
  rule-ink: "#141310"
  amber: "#e8850c"
  amber-deep: "#a85c00"
  amber-wash: "#fdf0dc"
  danger: "#c8102e"
  danger-wash: "#fbe4e7"
  info: "#0b3d91"
  info-wash: "#e5ecf8"
  clear: "#00693e"
  clear-wash: "#e2f0e8"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(40px, 5.2vw, 68px)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.035em"
    fontVariation: "wdth 82"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(28px, 3.6vw, 44px)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.035em"
    fontVariation: "wdth 82"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  quote:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.13em"
    fontVariation: "wdth 88"
  mono:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.02em"
    fontFeature: "tnum 1"
rounded:
  none: "0px"
  tab: "3px"
spacing:
  cell: "8px"
  tight: "12px"
  row: "16px"
  gutter: "24px"
  block: "32px"
  section: "40px"
  stage: "96px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.print}"
    rounded: "{rounded.none}"
    padding: "12px 20px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.bench-ink}"
    rounded: "{rounded.none}"
    padding: "12px 20px"
    typography: "{typography.label}"
  button-onlabel:
    backgroundColor: "transparent"
    textColor: "{colors.print}"
    rounded: "{rounded.none}"
    padding: "12px 20px"
    typography: "{typography.label}"
  badge-amber:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.print}"
    rounded: "{rounded.none}"
    padding: "3px 7px"
    typography: "{typography.label}"
  badge-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.label}"
    rounded: "{rounded.none}"
    padding: "3px 7px"
    typography: "{typography.label}"
  badge-info:
    backgroundColor: "{colors.info}"
    textColor: "{colors.label}"
    rounded: "{rounded.none}"
    padding: "3px 7px"
    typography: "{typography.label}"
  badge-clear:
    backgroundColor: "{colors.clear}"
    textColor: "{colors.label}"
    rounded: "{rounded.none}"
    padding: "3px 7px"
    typography: "{typography.label}"
  badge-plain:
    backgroundColor: "{colors.print}"
    textColor: "{colors.label}"
    rounded: "{rounded.none}"
    padding: "3px 7px"
    typography: "{typography.label}"
  badge-quiet:
    backgroundColor: "{colors.label-3}"
    textColor: "{colors.print}"
    rounded: "{rounded.none}"
    padding: "3px 7px"
    typography: "{typography.label}"
  panel:
    backgroundColor: "{colors.label}"
    textColor: "{colors.print}"
    rounded: "{rounded.none}"
    padding: "24px"
  panel-header:
    backgroundColor: "{colors.label}"
    textColor: "{colors.print}"
    rounded: "{rounded.none}"
    padding: "10px 16px"
    typography: "{typography.label}"
  stage-tab:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.print}"
    rounded: "{rounded.none}"
    padding: "12px 3px"
    typography: "{typography.label}"
  masthead:
    backgroundColor: "transparent"
    textColor: "{colors.bench-ink}"
    rounded: "{rounded.none}"
    padding: "16px 24px"
  topbar:
    backgroundColor: "{colors.bench-2}"
    textColor: "{colors.bench-ink}"
    rounded: "{rounded.none}"
    padding: "12px 24px"
---

# Design System: Care Loop

## Overview

**Creative North Star: "The Dispensing Bench"**

Care Loop is a pharmacy dispensing sleeve lying on a graphite press bench. The ground is
warm printing-ink graphite, never a neutral dark-mode grey; on it sits brilliant white
label stock, and stuck to the stock are adhesive auxiliary strips — the small printed
bands a pharmacist applies to say *take with food*, *may cause drowsiness*. The metaphor
is not decorative: a follow-up plan really is one instruction, issued once, governing
seven dated days, and the label is the object that behaves that way.

Two disciplines carry the whole system, and both are visible in the built code. **The
cell:** every measure is a multiple of an 8px unit, so nothing floats free and every rule,
row and strip lands on the same grid. **The strip:** colour arrives as a full printed band
with a word on it, never as a tint behind a container and never as a coloured edge on a
row. Those two rules are why there are no cards anywhere in this product and no
`border-left` accent pattern anywhere in the stylesheet.

Density is high and honest. Text sits at reading scale on white stock; numbers, ids,
dates and phone numbers are always mono and tabular because a clinician compares them by
eye. Motion is a thermal printer: paper advances downward, so content arrives from above
in a stagger and nothing on this product ever fades in place. Confirmed rejections: the
AI-SaaS hero (floating dashboard screenshot, feature-card triptych), rounded cards,
gradient tint behind content, and glyph decoration of any kind — there is no icon package
and no `public/` directory.

**Key Characteristics:**
- Graphite bench ground, brilliant white label stock, adhesive colour strips
- Square corners everywhere (`0`), one 3px exception on the pull tab's outer edge
- An 8px cell governs every padding, gap and dimension
- Hairline rules, perforations and a drawn barcode instead of illustration
- Archivo with a live width axis for print voice; Martian Mono for every number
- Red is danger and nothing else; amber carries the surface
- Motion advances downward, is always additive, never load-bearing

## Colors

A four-signal printed palette on two grounds: a warm graphite bench and white label stock,
with amber, red, blue and green appearing only as printed bands.

### Primary
- **Caution Amber** (`amber`): the carrying colour of the whole product. The primary
  button, the stage tab riding a sheet's left edge, the pull-to-compile tab, a missed call
  attempt, the "not built yet" mark, the honesty banner across the console, and the focus
  ring. One amber-filled primary per view — on the landing hero the pull tab is that one,
  which is why both hero buttons are ghosts.
- **Cut Amber** (`amber-deep`): amber that has to survive on white stock — the focus ring
  inside `.sheet`, the pulled state of the tab, the scrollbar thumb on hover.
- **Amber Wash** (`amber-wash`): the only tinted-fill amber, used for a *held* day in the
  week band, where a solid fill would read as an outcome that has not happened yet.

### Secondary
- **Danger Red** (`danger`): escalations, guard refusals, red-flag days, and the
  calls-are-live badge in the top bar. Nothing else in this product is ever red, including
  destructive-looking states that are not dangerous.
- **Signal Blue** (`info`): informational marks that are not judgements — the "Time
  defaulted" provenance strip is the canonical use.
- **Cleared Green** (`clear`): a resolved, answered, or built-and-tested state. It reports
  a fact; it is never a celebration.

### Neutral
- **Bench Graphite** (`bench`, `bench-2`, `bench-3`): the press bench. `bench` is the page
  ground and the html background so overscroll never flashes white; `bench-2` is chrome
  (top bar, closing band); `bench-3` is only the upper corner of the hero's radial ground.
- **Bench Hairline** (`bench-line`) and **Bench Edge** (`bench-line-strong`): a divider
  tone and a heavier tone. The divider tone is invisible as a *control* edge on graphite,
  so ghost buttons take the heavier one. Use `bench-line` to divide, `bench-line-strong`
  to bound something interactive.
- **Bench Ink** (`bench-ink`, `bench-ink-2`, `bench-ink-3`): text on graphite, tinted from
  the ground rather than grey. Primary / secondary / quiet, in that order.
- **Label Stock** (`label`, `label-2`, `label-3`): the sheet, an inset panel inside a
  sheet, and the fill for an inert day cell or a quiet plain strip.
- **Thermal Print** (`print`, `print-2`, `print-3`): ink on stock. `print` for values and
  names, `print-2` for prose and secondary cells, `print-3` for field labels and ids.
- **Sheet Rules** (`rule`, `rule-2`, `rule-ink`): the three-weight hairline set. `rule-ink`
  is a structural rule (under a header band, above a table body, beside a quotation);
  `rule` is a section divider; `rule-2` is a row divider inside a table.

### Named Rules

**The Red Means Danger Rule.** Red is reserved for danger: escalations, guard violations,
and live dialling. A single missed call attempt is amber; only an aggregate judgement —
drift, a red flag, a paused plan — earns red. A completed plan that has been silent for a
week is not red, because silence only alarms while someone is still supposed to answer.

**The Printed Band Rule.** Colour arrives as a full band with a word printed on it, never
as a tint behind a container and never as a coloured left edge on a row. If a state needs
colour, it needs a strip with a label; if it does not deserve a word, it does not deserve
colour.

**The One Amber Rule.** Exactly one amber-filled element is the primary action of a
viewport. Everything else that acts is a ghost or an on-label outline.

## Typography

**Display Font:** Archivo, self-hosted via `next/font/google` with its `wdth` axis live
(with `ui-sans-serif, system-ui, sans-serif`)
**Body Font:** Archivo, same family at normal width
**Label/Mono Font:** Martian Mono, self-hosted (with `ui-monospace, "SF Mono", Menlo,
monospace`)

**Character:** A signage grotesque with a real width axis, so the printed voice can be
genuinely condensed rather than squashed, paired with a mono that reads like thermal
printer output. Archivo carries the sleeve's headings and its field labels; Martian Mono
carries anything a clinician will compare by eye.

### Hierarchy
- **Display** (800, `wdth 82`, clamp 40–68px, line-height 0.92, tracking −0.035em):
  the landing hero, and nothing else. One page-owning statement per site. Balanced
  wrapping.
- **Headline** (800, `wdth 82`, clamp 28–44px, 0.92): every other heading — the sentence
  that opens each stage of the week, the landing page's closing section, and the
  console's answer to its own question ("2 patients need you."). The console stops at
  headline scale on purpose: a working surface states its answer, it does not shout it.
- **Title** (700, 17px, 1.3): the heading of a control block or a bordered column. Normal
  width — the condensed axis stops at headline scale.
- **Body** (400, 16px, 1.55; lede at 17px/1.6): prose. Constrained to 68ch by `.measure`,
  and to ~52ch for the fine-print disclaimer.
- **Quote** (400, 19px, 1.5): a patient's own words, indented behind a single structural
  hairline. It is set larger than body because it is the evidence, not commentary on it.
- **Label** (700, `wdth 88`, 11px, tracking 0.13em, uppercase): field labels, table
  headers, strip text, nav items, and the button face at 12px.
- **Mono** (Martian Mono, tabular figures, tracking −0.02em): every count, date, time,
  duration, id, rule name and masked phone number, at 11–26px depending on role.

### Named Rules

**The Field Label Rule.** Tracked caps are a field label on a printed form. They label a
value, a column, or a strip. They are never a kicker above a heading, and never a
sentence — an honesty statement set at 11px tracked caps is a notice nobody reads, so the
two on this product are set as ordinary 14px prose instead.

**The Compare-By-Eye Rule.** If a human will compare it to another instance of itself —
a count, a date, a time, an id, a phone number, a percentage — it is mono with tabular
figures. If they will read it as language, it is Archivo.

**The Masked Number Rule.** A phone number is rendered masked, everywhere, without
exception. This is a product rule before it is a visual one: the console appears in a
published video and on a public URL.

## Layout

**The cell.** `--cell: 8px` is the atom. Every padding, gap, height and offset in the
build is `calc(var(--cell) * n)`, with n from 0.5 to 12. Nothing is a raw pixel value
except hairlines, strip padding (3px 7px), and type sizes.

**Container.** A 1240px max width with 24px (3 cells) side padding, centred, on the
landing page, the top bar and the roster. The queue narrows to 940px because it is a
reading column: rule, evidence, decision.

**The descending edge.** The landing page's stages step rightward as they descend, via a
`--stage-step` custom property multiplied by the stage index: 0 below 720px, 2.5 cells
from 720px, 5 cells from 1000px. The indent draws the pipeline down the page; it collapses
to zero on narrow screens because there it would only steal measure.

**Breakpoints,** all min-width and all doing one job each: **720px** turns the refusal rows
two-column, starts the descending edge, and restores the masthead's descriptor; **860px** lets the top bar's dial-state block
return to the right-hand end instead of occupying its own row; **1000px** splits the hero
into 1.05fr / 0.95fr and widens the stage step.

**Density and wrapping.** Content grids are `repeat(auto-fit, minmax(Npx, 1fr))` —
380px for control blocks, 280px for the build-state columns, 180px for extracted answer
slots — so columns drop rather than compress. Tables set a `minWidth` (620–880px) inside
an `overflow-x: auto` sheet: a table shrinks by scrolling, never by squeezing a column
out of legibility. The top bar wraps rather than compressing, so the badge that says
whether this build can phone a person can never be clipped.

### Named Rules

**The Cell Rule.** Every measure is a multiple of 8px. A value that is not a multiple of
the cell is a bug unless it is a hairline or a type size.

**The Never-Imply-A-Login Rule.** The chrome states "Dr Rao · demo, no auth" and shows the
dial state on every console page. There is no auth in this product, so no avatar, no
account menu, and no sign-out affordance may appear in the top bar.

## Elevation & Depth

There is no elevation system in the general sense: nothing on the bench is "raised" by
state, nothing lifts on hover, and there is no ambient shadow vocabulary. There is exactly
one shadow, and it is a material fact rather than a hierarchy signal — a sheet of label
stock stuck to a bench, which casts a tight contact edge and a soft, short throw. Depth
otherwise comes from the two grounds (graphite versus white stock) and from the three-weight
hairline set. Structure is drawn, not floated.

### Shadow Vocabulary
- **Stuck to the bench** (`box-shadow: 0 1px 0 rgba(0,0,0,0.22), 0 10px 24px -10px
  rgba(0,0,0,0.55)`): applied by `.sheet` and by the pull tab. It is the only shadow in
  the system, and it never changes on interaction.

### Named Rules

**The Contact-Shadow Rule.** Shadow describes contact with the bench, not importance.
Never add a second shadow, never deepen one on hover, and never shadow anything that is
not label stock.

## Shapes

Square is the rule, not a default: `--radius: 0`. A dispensing label has no rounded
corners, so sheets, strips, buttons, day cells and inputs are all hard-cornered. The single
exception in the build is `--radius-tab: 3px` on the *outer* edge of the pull tab — a
physical tab is die-cut, and the rounding appears only on the two corners that face away
from the sheet.

The recurring geometry is orthogonal and printed:

- **Hairline rules** in three weights, doing structural / section / row work.
- **Perforation** (`.perf`): drawn as holes punched through the stock — a repeating radial
  gradient in the bench colour on a 12px pitch — never as a dashed border, because a punch
  reads as light coming through the paper.
- **The barcode** (`.barcode`): a 24px-tall repeating-linear-gradient block in print ink,
  built from the stock rather than shipped as an image. Every dispensing label carries one.
- **The vertical tab**: `writing-mode: vertical-rl` caps riding a sheet's left edge, used
  for stage names and the pull action. A sleeve is indexed by tabs on its edge.
- **The seven-cell band**: fixed 14px × 20px cells, 2px apart, one per day.

## Components

### Buttons
- **Shape:** hard square corners (`0`), 1px border box, tracked caps at 12px, 12px × 20px
  padding (1.5 × 2.5 cells).
- **Primary:** amber fill, print-ink text. The one amber-filled thing in a view.
- **Ghost:** transparent on graphite, bench ink text, bounded by the heavier bench edge —
  the divider tone is invisible as a control edge and must not be used here.
- **On-label:** transparent on white stock, print ink text, bounded by the structural
  ink hairline. This is the secondary action *inside* a sheet.
- **Hover / Focus:** background and colour transition over 140ms ease-out; focus shows the
  global 2px amber ring at 2px offset, cut to `amber-deep` inside `.sheet`.
- **Disabled:** 0.45 opacity and `not-allowed`, and — per the product's own rule — a
  disabled control says why in adjacent caps ("Not wired up yet") rather than sitting
  there mutely.

### Strips (the Badge)
- **Style:** an adhesive auxiliary strip. Solid tone fill, 3px × 7px padding, tracked caps,
  no radius, no shadow, never wrapping.
- **Tones:** amber (caution, in progress), danger (escalation, live dialling), info
  (provenance, defaults), clear (resolved, verified), plain (print-ink fill for a neutral
  identifier such as a rule name).
- **Quiet variant:** wash background with a 1px inset ring in the full tone, print-ink
  text. Used when a state is inert — scheduled, completed, an id — and would over-signal
  as a solid band.

### Sheets (the Panel)
- **Corner Style:** square (`0`). It is label stock, not a card; do not describe or treat
  it as one.
- **Background:** white label stock, print ink text.
- **Shadow:** the single contact shadow (see Elevation & Depth).
- **Header band:** optional. A tracked-caps title on the left, free-form aside on the
  right, separated from the body by the structural ink hairline — the way a dispensing
  label carries the pharmacy's name across its top.
- **Internal Padding:** 24px (3 cells) for prose bodies; 10px × 16px in the header band;
  tables sit flush and carry their own cell padding of 12–16px.

### Tables
- **Header:** tracked caps in `print-3`, left-aligned, `nowrap`, under a structural ink
  hairline.
- **Rows:** divided by the lightest hairline; numeric and identifying cells mono; the
  state cell carries a strip.
- **Overflow:** a minimum width inside a horizontally scrolling sheet. Never collapse a
  column to fit.

### Navigation
- **Masthead (landing):** the product name printed across the top of the label, the way a
  sleeve carries the dispensing pharmacy's name. Transparent over the hero ground, a
  `bench-line` hairline beneath, 16px x 24px padding inside the 1240px container. The
  wordmark sits left in condensed display at 22px linking home; right carries a tracked-caps
  descriptor in `bench-ink-3` and a `Console` link in `bench-ink`. The descriptor is the
  only element that drops on narrow screens (hidden below 720px); the wordmark and the
  console link never drop.
- **Top bar (console):** sticky, `bench-2` ground, bench hairline underneath, wordmark set in
  condensed display at 19px, nav items in tracked caps at `bench-ink-2`. The right-hand
  block states the two things the demo must never imply otherwise: who is signed in
  (nobody) and whether the build can dial — a danger strip when calls are live, a quiet
  plain strip when nothing can dial.

### The Week Band
Seven fixed cells on a shared x-axis, so a roster reads down a column: every patient's day
3 sits at the same position. Green answered, red flagged, amber missed, amber-wash-with-ring
held, `label-3` scheduled, hairline-ring empty. It carries a full `aria-label` naming every
day's state and per-cell `title`s, because colour alone is not the information.

### The Compile Pull
The product's one authored interaction, and the reason the landing page needs no product
screenshot. A doctor's note sits as raw mono text on a sheet; a perforated amber tab down
its right edge is draggable, clickable and keyboard-operable, and pulling it restructures
the note *in place* into seven dated rows, typed answer sets, the three locked rules as
strips, and a barcode at the foot. It is reversible, because the claim being made is that
the doctor stays the author. The tab darkens to `amber-deep` when pulled and translates
6px with the pull progress.

### Motion
- **`advance`** (300ms, `cubic-bezier(0.16, 1, 0.3, 1)`, staggered 40ms by a `--i` index):
  table rows feeding out of a printer. It starts at 0.3 opacity, never 0.
- **`feed`** (340–380ms, same easing): a content swap arriving from 10px above. Reserved
  for a state change the user just caused, where a zero-opacity start is safe.
- **`strip-in`** (420ms): an adhesive strip applied from the right edge, not faded on.
- `prefers-reduced-motion: reduce` collapses all animation, transition and scroll behaviour
  globally.

### Named Rules

**The Additive Motion Rule.** Content is fully opaque and complete before any animation
runs; the animation is only ever added. A scroll-triggered reveal whose observer never
fires must still render a finished page, which is why the row stagger floors at 0.3 opacity
and never at 0.

**The Two Chromes Rule.** Each surface has its own chrome and they are not interchangeable.
The landing masthead carries the wordmark and a way into the console. The console top bar
carries the dial state and the no-auth statement, which the landing page has no business
showing. A surface gets one of them, never both, and never a hybrid.

**The Feed-Versus-Advance Rule.** `feed` starts at zero opacity and belongs to a content
swap the user just triggered. `advance` starts at 0.3 and belongs to rows. A row reveal
never drops to zero opacity: mid-stagger it photographs as an empty sheet, and this
product gets recorded.

**The Advance Rule.** Paper moves downward out of a printer. Content arrives from above,
staggered. Nothing in this product fades in place, slides up, or scales in.

## Do's and Don'ts

### Do:
- **Do** express every measure as a multiple of the 8px cell.
- **Do** deliver colour as a printed band with a word on it — a `Badge` — and reach for the
  quiet variant when the state is inert.
- **Do** keep red for danger only: escalation, guard violation, live dialling. A single
  missed attempt is amber.
- **Do** set every count, date, time, id and masked phone number in Martian Mono with
  tabular figures.
- **Do** bound ghost controls on graphite with `bench-line-strong`; the divider tone
  disappears as a control edge.
- **Do** state what is not built, on screen, in ordinary prose — a stub carries a label
  saying it is a stub.
- **Do** reuse `Badge`, `Button`, `Panel`, `Masthead`, `TopBar`, `WeekBand`. A new one-off button is a
  bug.
- **Do** give every non-text signal a text equivalent, as the week band does with its
  `aria-label` and per-cell titles.

### Don't:
- **Don't** round a corner. Radius is `0`; the only exception in the system is the 3px
  outer edge of the pull tab.
- **Don't** build a card — no floating rounded container, no shadow-on-hover, no tinted
  panel background. Content sits on label stock or on the bench.
- **Don't** signal state with a coloured left border or a tinted row background. If it
  needs colour, it needs a strip with a word on it.
- **Don't** use tracked caps as a kicker above a heading, or to set a sentence. Caps are
  field labels.
- **Don't** put a second amber-filled element in a view; there is one primary action.
- **Don't** fade content in place, or make any content depend on an animation or an
  observer to become visible.
- **Don't** add a shadow that means importance; the one shadow in the system means contact
  with the bench.
- **Don't** show an unmasked phone number anywhere, under any condition.
- **Don't** mix the two chromes: no dial state or no-auth line on the landing masthead, no
  marketing descriptor in the console top bar.
- **Don't** put an avatar, account menu or sign-out control in the chrome. There is no
  auth, and the chrome says so.
- **Don't** introduce a glyph icon, an icon font, or an image asset — this world draws its
  marks (perforation, barcode, rules, bands) from the stock itself.

<!--
Known state at ship, recorded as defects the build carries, not as system rules:
  - An optical side-bearing gap between condensed display headings and the hard sheet
    edge below them. Unresolved; do not codify the current offset.
  - The perforation tear line under the week table reads faint at desktop scale.
  - The console renders from `lib/fixtures.ts`, which is temporary; the amber honesty
    banner is what makes that legible and is not a permanent chrome element.
-->
