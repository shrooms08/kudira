# Kudira Indigo — design tokens

Extracted once from `design/Kudira Indigo.html` (a self-extracting bundle;
decode the `__bundler/template` script to read the markup). **Work from this
file, not the bundle.** Source of truth order: the bundle > this file > code.

Redesign lives on the `redesign` branch only. Master is the shipped Amber build.

---

## 1. Palette (inline hex in source; defined as CSS vars in globals.css)

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#000000` | Page ground |
| `--raised` | `#141414` | Cards, the credential face |
| `--raised-2` | `#1E1E1E` | Secondary raised, insets, motif strokes |
| `--accent` | `#C4F82A` | Acid lime. The single accent: CTAs, active, brand mark |
| `--accent-hi` | `#D4FF45` | Accent hover/lift (used sparingly) |
| `--bone` | `#F5F5F0` | Primary text on dark |
| `--signal` | `#00D084` | **Signal only:** verified, on time, paid, not-revoked |
| `--warn` | `#FF6B4A` | **Genuinely rare:** missed payment, refusal, and the Delinquent ladder row label. Nowhere else. |

**Bone text alphas** (`rgba(245,245,240,α)`): `.75` emphasis, `.62` body (workhorse),
`.55` labels, `.5` muted, `.42` faintest. Hairlines: `.14` default divider on dark,
`.09` card border, `.28` outline chips. Plus black insets `rgba(0,0,0,.8–.95)`.

The debossed grade is `color:#2b2b2b` with `text-shadow:0 1.5px 0 rgba(245,245,240,.34), 0 -1px 0 rgba(0,0,0,.92)` — lifted fill and a stronger lower light edge so it reads at a glance while staying struck into the face. It is the card's second figure after the limit; do not recess it further.

## 2. Type — three families

| Role | Family (next/font/google) | Notes |
|---|---|---|
| Display / headings | **Instrument Serif** | 34–56px, `letter-spacing:-0.01em` |
| UI / body / labels | **Archivo** | 13–15px body |
| **Every figure + eyebrow** | **JetBrains Mono** | `font-variant-numeric: tabular-nums` always; eyebrows uppercase, `letter-spacing:0.14–0.22em` |

Every number goes through JetBrains Mono + `tabular-nums`. No exceptions.

## 3. Adire motifs — data URIs, colours `%23`-encoded

The `#` in an SVG data URI **must** be written `%23` or the pattern renders
invisible. Verbatim from source (all `background-repeat:repeat`):

- `.ku-m-dots` — 18×18, `fill='%23262626'`, two dots on a diagonal.
- `.ku-m-stripes` — 20×20, `stroke='%23262626'`, broken horizontal rules.
- `.ku-m-circles` — 34×34, `stroke='%23262626'`, three concentric circles.
- `.ku-stamp` — 12×12, `fill='%23A5D423'`, two lime specks.
### The card field — 34px concentric circles (the weave was dropped)

The credential face is `.ku-card-circles`: concentric circles at a **34px tile**,
`stroke='%23262626'`, on the `#141414` face. The 9px crosshatch weave was tried
and **dropped** — it read as generic fabric texture; the circles read as *stamped
adire*. The 34px scale matters: larger (≈90px) and a ring sits behind the grade
and fights the typography; at 34px the circles read as a dense stamped field and
recede behind the content. **Card motif = 34px circles. There is no weave.**

## 4. Motion — exactly three places, all `cubic-bezier(0.16,1,0.3,1)`

Nothing else moves.

1. **Approved-limit count-up** — integer 0 → value over **600ms** (`CountUp.tsx`).
2. **Grade bar** — animates `width` to the grade's position on mount (`GradeBar.tsx`).
3. **Compliance rows** — stagger in, opacity, **120ms apart** (dashboard only).

## 5. The credential card (centrepiece)

- `aspect-ratio: 1.586 / 1` (ISO/IEC 7810 ID-1), bg `--raised`, radius 28px,
  border `rgba(245,245,240,.09)`, deep drop shadow + inset highlight/shadow (deboss).
- 34px concentric-circle field on the face (`.ku-card-circles`).
- Top-left: `A-PASS` label + a VERIFIED signal pill (green dot + text).
- Top-right: issuer reference (real: A-Pass `cvRecordId`) + the Kudira lime mark.
- Bottom-left: approved-limit figure (Mono 700, ~66px, tabular) with an eased-in
  `.00`, then `Approved limit · KUSDC`.
- Bottom-right: the grade **debossed** + `SUBTIER n`.
- Bottom edge: three struck attributes — BANK VERIFIED / NON-TRANSFERABLE /
  NOT REVOKED (the last green; if revoked, warn + "REVOKED").

### The unseeded case (handled IN the card, not per-screen)

A fresh borrower has no on-chain credit line: `gradeOf` → 0, `bandOf` →
`"delinquent"`, while the credential says subTier 50. The card must **never**
borrow the delinquent band for a grade of zero. When `rated` (on-chain
`CreditLine.exists`) is false, the grade slot renders **"Not yet rated"** in muted
bone — not a red Delinquent. The approved-limit figure then shows the entitlement
the credential grants (subTier × the on-chain per-grade limit), which is exactly
what the first origination will seed. All values remain real.

## 6. Constraints (carried from the brief)

- All real data. No mocked values in the app (the standalone preview uses labelled
  sample values only).
- The grade ladder stays **open** on the account page — not a dropdown.
- Every figure in JetBrains Mono with `tabular-nums`.
- Keep existing API routes and chain reads. Visual rebuild, not a rewrite.
