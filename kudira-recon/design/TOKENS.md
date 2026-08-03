# Kudira design tokens

Extracted from the Claude Design bundles in `design/` (`checkout-v2.html`,
`merchant-dashboard.html`, `logo.html`). **This file is the day-to-day
reference.** Only open the bundles when you need exact markup for one specific screen,
and then decode first (see "Working with the bundles" at the bottom) — they are ~1-2MB
of embedded fonts and a base64 asset blob, not readable as-is.

Source of truth, in order: these three HTML files > this file > anything in code.

---

## 1. Colour

### Core

| Token | Value | Use |
|---|---|---|
| `ink` | `#14161F` | Primary text, dark surfaces, the near-black brand ground |
| `ink-raised` | `#23262F` | Raised surface on dark (cards on an ink background) |
| `amber` | `#E9A13B` | The single accent. CTAs, active states, brand mark |
| `amber-light` | `#F2B25B` | Amber gradient top stop, hover lift |
| `amber-deep` | `#D8912E` | Amber gradient bottom stop, pressed |
| `amber-ink` | `#B87516` | Link hover, amber text on light |
| `amber-shadow` | `#8A5610` | Deepest amber, used sparingly for text on amber |

### Warm neutrals

| Token | Value | Use |
|---|---|---|
| `paper` | `#FAF8F5` | Page background. The warm base everything sits on |
| `paper-sunk` | `#EFEBE4` | Sunken wells, inset rows, track backgrounds |
| `paper-amber` | `#FDF7EC` | Amber-tinted panel, used for credential/compliance callouts |
| `white` | `#FFFFFF` | Cards, sheets, elevated surfaces |

### Alphas — every `rgba()` actually used

All ink alphas are `rgba(20,22,31,α)`; all white alphas `rgba(255,255,255,α)`.

**Ink on light** (text hierarchy — these three carry almost everything):

| α | Use | Frequency |
|---|---|---|
| `0.68` | Secondary body text. The workhorse | 68 |
| `0.62` | Tertiary text, metadata | 36 |
| `0.45` / `0.5` / `0.55` | Muted labels, placeholder, disabled | 10 / 10 / 4 |
| `0.72` / `0.75` / `0.78` / `0.8` / `0.82` | Emphasis just short of full ink | 17 / 12 / 5 / 2 / 6 |
| `0.6` / `0.65` / `0.7` | Mid-weight secondary | 22 / 3 / 3 |
| `0.4` / `0.42` | Faintest readable text | 1 / 1 |

**Ink hairlines and shadows** (borders, dividers, elevation):

| α | Use |
|---|---|
| `0.04` / `0.055` / `0.06` | Shadow layers, faintest fills |
| `0.07` / `0.08` / `0.09` | Hairline borders — the default divider is `0.08` |
| `0.1` / `0.11` / `0.12` | Stronger borders, input outlines |
| `0.14` / `0.16` / `0.18` | Pressed states, drawer shadow |
| `0.2` / `0.22` | Heaviest hairline |

**White on dark:**

| α | Use |
|---|---|
| `0.72` | **Glass fill** (see §5) and secondary text on ink |
| `0.6` / `0.5` | Body text on ink |
| `0.4` / `0.35` | Muted text on ink |
| `0.09` | Hairline divider on ink |

**Amber alpha:** `rgba(216,145,46,0.8)` — amber glow in the CTA shadow only.

---

## 2. Type

Three families, strict division of labour. Never substitute across roles.

| Role | Family | Stack as written |
|---|---|---|
| Headings, display, numerals-as-display | **Source Serif 4** | `'Source Serif 4', Cambria, Georgia, serif` |
| Body, UI, labels, buttons | **IBM Plex Sans** | `'IBM Plex Sans', sans-serif` |
| **All numbers** | **IBM Plex Mono** | `'IBM Plex Mono', monospace` |

Plex Mono is the most-used family in the bundles (114 declarations) because every
figure goes through it: amounts, dates, counts, subTier values, plan IDs, ledger rows.

**Tabular alignment note:** there are no `font-variant-numeric: tabular-nums`
declarations anywhere. Alignment comes from Plex Mono being monospaced. If you ever
render a figure in Plex Sans, add `font-variant-numeric: tabular-nums` yourself —
otherwise columns will not line up.

### Scale

Only two weights exist: **500** and **600**. There is no 400 and no 700.

| px | Role |
|---|---|
| `80` / `76` / `64` | Hero amount on a screen (the "500.00 aUSDC" figure) |
| `44` / `36` | Screen-title numerals |
| `34` / `32` / `30` / `28` | Section headline (Source Serif 4) |
| `27` / `25` / `24` / `21` | Sub-headline, large label |
| `19` / `18` / `17` | Lead paragraph |
| `16` / `15.5` / `15` | Body |
| `14.5` / `14` | Body small, list rows |
| `13.5` / `13` | **The dominant UI size** — labels, table cells, secondary rows |
| `12.5` / `12` | Caption, dense metadata |
| `11` / `10` | Eyebrow labels, legal, badge text |

### Letter-spacing

| Value | Use |
|---|---|
| `0.18em` | **Eyebrow labels** — uppercase section headers. The signature treatment (30 uses) |
| `0.22em` / `0.2em` / `0.16em` / `0.14em` / `0.12em` | Other uppercase tracking, wider = smaller text |
| `-0.02em` | Large headings (14 uses) |
| `-0.04em` / `-0.03em` | Hero numerals, tightest optical setting |
| `-0.015em` | Sub-headline |

Uppercase + `0.18em` + 10-11px + Plex Sans is the eyebrow recipe used for every
section label in both files.

---

## 3. Radii

| Value | Use |
|---|---|
| `999px` | Pills — badges, chips, segmented controls, primary buttons (37 uses) |
| `50%` | Avatars, circular icon buttons, status dots (50 uses) |
| `28px` | Sheets, largest cards |
| `24px` | **Default card / panel radius** and the floating nav (20 uses) |
| `18px` / `16px` | Inner cards, nested panels |
| `14px` / `12px` / `10px` | Inputs, small tiles, list rows |
| `2px` | Progress-bar fill, hairline accents |

---

## 4. Shadow

### The layered card recipe — use this by default

```css
box-shadow: 0 1px 2px rgba(20,22,31,0.04), 0 8px 24px rgba(20,22,31,0.06);
```

Two layers: a 1px contact shadow that seats the card on the paper, and a wide soft
ambient at 24px. 34 uses — this is *the* elevation. Do not invent alternatives.

### The others (each has exactly one job)

```css
/* hairline lift, for rows and inputs */
box-shadow: 0 1px 3px rgba(20,22,31,0.1);

/* upward shadow — sticky bottom bars casting onto content above */
box-shadow: 0 -8px 32px rgba(20,22,31,0.06);

/* dark-surface lift */
box-shadow: 0 8px 20px -8px rgba(20,22,31,0.68);
box-shadow: 0 8px 20px -8px rgba(20,22,31,0.5);

/* amber CTA: inset top highlight + coloured glow beneath */
box-shadow: 0 1px 0 rgba(255,255,255,0.5) inset, 0 8px 18px -8px rgba(216,145,46,0.8);
box-shadow: 0 1px 0 rgba(255,255,255,0.5) inset, 0 6px 14px -6px rgba(216,145,46,0.8);

/* side drawer */
box-shadow: -24px 0 60px rgba(20,22,31,0.18);
```

---

## 5. Glass — the constrained material

```css
background: rgba(255,255,255,0.72);
backdrop-filter: blur(20px) saturate(180%);
-webkit-backdrop-filter: blur(20px) saturate(180%);
```

**Glass appears on exactly two elements, both in Checkout, and nowhere else.**
Verified: 3 occurrences in `checkout-v2.html`, **0** in `merchant-dashboard.html`,
**0** in `logo.html`.

1. **The sticky checkout pay bar** — `position:sticky; bottom:0; z-index:40`
2. **The floating bottom nav** — `margin:0 16px 16px; border-radius:24px; z-index:40`

### The rule

**Never put glass behind a number.** Amounts, balances, subTier values and ledger
figures sit on opaque `#FFFFFF` or `#FAF8F5`. Blur behind a figure costs legibility
and reads as decoration on exactly the element that must be trusted. Both permitted
uses are chrome that floats *over* content, never content itself.

Do not extend glass to cards, modals, headers, or the dashboard. If a new surface
seems to want it, it wants elevation instead — use the layered card shadow.

---

## 6. Grade ladder display mapping

Taken verbatim from the "THE LADDER" panel in Checkout screen 7. This matches
`CreditLine.limitForGrade` and `CreditLine.gradeBand` in the contracts.

| subTier | Letter | Limit (aUSDC) |
|---|---|---|
| 80–99 | **Grade A** | 800.00 – 990.00 |
| 60–79 | **Grade A−** | 600.00 – 790.00 |
| 50–59 | **Grade B+** | 500.00 – 590.00 |
| 30–49 | **Grade B** | 300.00 – 490.00 |
| 10–29 | **Grade C** | 100.00 – 290.00 |
| 0–9 | **Delinquent** | no new plans |

Published rule, as worded in the UI:

> Limit is subTier × 10 aUSDC. On-time payment +5, default −20, both saturating at
> the ends of the scale.

Supporting copy patterns the UI uses, worth reusing verbatim:

- `Grade B+ · subTier 50` — standing line
- `subTier 30 × 10 · reduced from 500.00 on 27 Aug` — after a default step
- `+5 per on-time payment · A− at 60` — forward-looking nudge
- `subTier 50 → 30, a −20 saturating step. Grade B+ → B, limit 500.00 → 300.00.`
- `The credential stays active.` — always paired with a downgrade
- `One default step recorded on 27 Aug… The record ages out after twelve months.`

**Typography detail:** the UI renders A-minus as `A−` (U+2212 minus sign), not a
hyphen. The contract's `gradeBand()` returns ASCII `"A-"`. Render the UI form in the
frontend; the contract string is for on-chain consistency, not display.

---

## 7. Screen inventory

### `checkout-v2.html` — 7 frames, mobile

| # | Screen | Key sections |
|---|---|---|
| 1 | **Demo index** (cover) | Lists the flow: `1 Storefront · glass`, `2a Reading credential`, `2b Recognised`, `3 …` |
| 2 | **Reading your A-Pass** — step 2 of 3 | `Standing only — never documents`, `✓ Credential located`, `✓ Issuer signature` |
| 3 | **Recognised / approved** — step 2 of 3 | `APPROVED CREDIT LIMIT` (hero 500.00), `Established · subTier 50`, `Credential`, `Standing`, `History`, `Bank verified / Non-transferable / Not revoked` |
| 4 | **Your payment** — step 3 of 3 | `32.50 × 4`, `130.00 total · every 2 weeks · 0% interest`, dated instalment list |
| 5 | **Buyer home** | `NEXT PAYMENT`, `STANDING`, `ACTIVE PLANS`, `HISTORY` |
| 6 | **Missed payment** | `PAYMENT DUE`, `MISSED PAYMENT`, `WHAT HAPPENS NEXT`, `WHAT IS NOT AFFECTED`, `THE ROUTE BACK` |
| 7 | **Standing after default** | `AVAILABLE TO SPEND` (300.00), `STANDING`, `THE LADDER`, `HOW TO RECOVER` |

Storefront sections also present: `YOUR BAG`, `PAYMENT METHOD`, `DELIVERY`,
`FROM OTHER BUYERS`, `DUE TODAY`.

### `merchant-dashboard.html` — desktop, 640px content column on 1440px

| Screen | Key sections |
|---|---|
| **Overview** | Nav: `Overview · Settlements · Active plans · Compliance · Payouts`. Stats: `SETTLED TO YOU` (18,420.00 aUSDC, `Paid in full at checkout · 0 chargebacks`), `ACTIVE PLANS` (42, `Buyer credit risk sits with Kudira, not with you.`), `SETTLEMENT TIME` (~2s, `Median, checkout to funds on Base.`). Table: `DATE · BUYER · PLAN · AMOUNT · TRAVEL RULE`, buyers pseudonymous (`QX`, `KU-4471-QX`) |
| **Travel Rule record** | `TRAVEL RULE RECORD`, `AMOUNT`, `TIMESTAMP`, `ORIGINATING INSTITUTION`, `ORIGINATOR — ATTESTED, NOT DISCLOSED`, `BENEFICIARY`, `INTEGRITY` |

Standing compliance line: `Buyers are pseudonymous. Kudira never discloses identity
to merchants.`

### `logo.html`

Logo lockup only. 1400px canvas, 660px mark. No glass, no card shadows, one `Kudira`
wordmark. Source Serif 4.

---

## 8. Working with the bundles

Each file is ~386 lines but 1-2MB. The weight is in two places, neither of which you
want to read:

- **line 372** — a ~1.87MB JSON asset blob (gzipped base64)
- the `@font-face` block — full woff2 payloads for all three families

The actual page is a **JSON-escaped HTML string** on the last long line. Decode it
before grepping, or you will be reading escape sequences:

```bash
cd design
python3 - <<'PY'
import json, glob, re
for f in sorted(glob.glob("*.html")):
    best = None
    for line in open(f, encoding="utf-8", errors="replace"):
        s = line.strip()
        if s.startswith('"<!DOCTYPE') or s.startswith('"<!doctype'):
            try: html_ = json.loads(s.rstrip(','))
            except Exception: continue
            if best is None or len(html_) > len(best): best = html_
    if best:
        best = re.sub(r'url\("[0-9a-f-]{36}"\)', 'url(FONT)', best)
        open(f.replace(".html", ".page.html"), "w").write(best)
PY
```

That yields 12-76KB of real markup per file, which greps cleanly. The `*.page.html`
outputs are derived artifacts — regenerate rather than edit, and keep them out of git.

Styling is **all inline `style=""` attributes**. There are no CSS custom properties
and no classes in the output, so the tokens above were recovered by frequency
analysis. When porting to the frontend, define these as real variables once rather
than copying inline styles forward.
