// Formatting rules for the whole app. Everything numeric goes through here.

/// KUSDC and aUSDC both have SIX decimals. Never assume 18.
export const DECIMALS = 6;

/// Format a 6-decimal on-chain amount as "1,234.50".
export function formatAmount(raw: bigint | number | string | undefined | null): string {
  if (raw === undefined || raw === null) return "—";
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const unit = 10n ** BigInt(DECIMALS);
  const whole = abs / unit;
  const frac = abs % unit;
  const cents = (frac / 10n ** BigInt(DECIMALS - 2)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}.${cents}`;
}

/// Split an amount so the major part can be set larger than the cents, which is
/// how every figure is typeset in the design.
export function splitAmount(raw: bigint | number | string | undefined | null) {
  const s = formatAmount(raw);
  const [major, minor = "00"] = s.split(".");
  return { major, minor };
}

/**
 * THE ONE PLACE the letter grade is rendered.
 *
 * The contract's `gradeBand()` returns ASCII `"A-"`. The published UI renders
 * A-minus with U+2212 MINUS SIGN, `"A−"`, which is typographically correct and
 * what every screen in design/ shows.
 *
 * Inline this mapping in three components and one of them will drift, so it
 * lives here and nowhere else. The contract remains the source of truth for
 * WHICH band applies; this only controls how that band is drawn.
 */
export function formatGrade(band: string | undefined | null): string {
  if (!band) return "—";
  if (band === "A-") return "A−";
  if (band === "delinquent") return "Delinquent";
  return band;
}

/// Grade ladder, exactly as published. Kept beside formatGrade so the label and
/// the band boundaries cannot drift apart.
export const LADDER = [
  { min: 80, max: 99, band: "A", limitLabel: "800–990" },
  { min: 60, max: 79, band: "A-", limitLabel: "600–790" },
  { min: 50, max: 59, band: "B+", limitLabel: "500–590" },
  { min: 30, max: 49, band: "B", limitLabel: "300–490" },
  { min: 10, max: 29, band: "C", limitLabel: "100–290" },
  { min: 0, max: 9, band: "delinquent", limitLabel: "no new plans" },
] as const;

/// Unix seconds -> "17 Aug".
export function formatDate(ts: bigint | number | undefined | null): string {
  if (ts === undefined || ts === null) return "—";
  const n = Number(ts);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/// Unix seconds -> "17 Aug 2026, 14:05".
export function formatDateTime(ts: bigint | number | undefined | null): string {
  if (ts === undefined || ts === null) return "—";
  const n = Number(ts);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/// Seconds -> "90s" / "1.4 days", for grace windows and cadences.
export function formatDuration(seconds: bigint | number | undefined | null): string {
  if (seconds === undefined || seconds === null) return "—";
  const s = Number(seconds);
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} hours`;
  return `${(s / 86400).toFixed(1)} days`;
}

/// 0x1234…abcd — `size` hex chars either side of the ellipsis.
/// Verified faithful: size=6 on 0x09187143…2cEc88afd gives 0x091871…c88afd,
/// which is exactly the first and last six hex characters.
export function shortAddress(a: string | undefined | null, size = 4): string {
  if (!a) return "—";
  return `${a.slice(0, 2 + size)}…${a.slice(-size)}`;
}

export const explorerTx = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
export const explorerAddress = (a: string) => `https://sepolia.basescan.org/address/${a}`;
