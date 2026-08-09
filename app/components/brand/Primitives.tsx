import { formatGrade, splitAmount } from "@/lib/format";

const mono = "var(--font-jetbrains-mono), ui-monospace, monospace";
const serif = "var(--font-instrument-serif), Georgia, serif";

/// Uppercase mono section label (design/INDIGO_TOKENS.md §2).
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

/// A figure. ALWAYS JetBrains Mono, tabular. `size="hero"` sets the cents
/// smaller than the major part, how every large amount is typeset.
export function Amount({
  value,
  unit,
  size = "body",
}: {
  value: bigint | number | string | undefined | null;
  unit?: string;
  size?: "hero" | "large" | "body";
}) {
  const { major, minor } = splitAmount(value);
  if (size === "body") {
    return (
      <span className="num" style={{ letterSpacing: "-0.01em" }}>
        {major}.{minor}
        {unit ? <span style={{ color: "var(--bone-50)" }}> {unit}</span> : null}
      </span>
    );
  }
  const majorSize = size === "hero" ? 72 : 34;
  const minorSize = size === "hero" ? 30 : 18;
  return (
    <div className="num" style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
      <span style={{ fontSize: majorSize, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 0.9 }}>{major}</span>
      <span style={{ fontSize: minorSize, color: "var(--bone-50)", letterSpacing: "-0.02em" }}>.{minor}</span>
      {unit ? <span style={{ fontSize: minorSize, color: "var(--bone-50)", marginLeft: 8 }}>{unit}</span> : null}
    </div>
  );
}

/// The letter grade as a small mono chip. Monochrome by design — the grade's
/// real home is the debossed figure on the credential card; this is a secondary
/// indicator. Delinquent is dimmed, NOT warned: warn (#FF6B4A) is reserved for
/// missed/refused and the Delinquent ladder row alone.
export function GradeBadge({ band, subdued = false }: { band: string; subdued?: boolean }) {
  const delinquent = band === "delinquent";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: mono,
        minWidth: delinquent ? undefined : 30,
        padding: delinquent ? "4px 12px" : "4px 11px",
        borderRadius: "var(--r-pill)",
        background: "var(--raised-2)",
        border: "1px solid var(--line-14)",
        color: delinquent || subdued ? "var(--bone-55)" : "var(--bone)",
        fontSize: delinquent ? 11 : 13,
        fontWeight: 600,
        letterSpacing: delinquent ? "0.08em" : "0.02em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {formatGrade(band)}
    </span>
  );
}

export function Card({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`card ${className}`} style={{ padding: 20, ...style }}>
      {children}
    </div>
  );
}

export function Divider() {
  return <div style={{ height: 1, background: "var(--line-08)" }} />;
}

/// Raw API payload, verbatim. Used where the actual response IS the evidence.
export function RawJson({ value }: { value: unknown }) {
  return (
    <pre
      className="num"
      style={{
        fontSize: 11,
        lineHeight: 1.6,
        background: "#0a0a0a",
        color: "var(--bone-62)",
        border: "1px solid var(--line-09)",
        padding: 14,
        borderRadius: "var(--r-input)",
        overflowX: "auto",
        margin: 0,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/// The lime mark + wordmark. The mark is the acid-lime "K" from the design source.
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.5) }}>
      <svg width={Math.round(size * 1.05)} height={Math.round(size * 1.05)} viewBox="0 0 512 512" style={{ display: "block", flex: "none" }} aria-hidden>
        <path
          fillRule="evenodd"
          fill="var(--accent)"
          d="M150 72 H362 A78 78 0 0 1 440 150 V362 A78 78 0 0 1 362 440 H150 A78 78 0 0 1 72 362 V150 A78 78 0 0 1 150 72 Z M144 130 H196 V382 H144 Z M262.8 240.9 L372.7 148.7 L349.7 121.1 L239.8 213.3 Z M239.8 298.7 L349.7 390.9 L372.7 363.3 L262.8 271.1 Z"
        />
      </svg>
      <span style={{ fontFamily: serif, fontSize: Math.round(size * 1.2), letterSpacing: "-0.01em", color: "var(--bone)", lineHeight: 1 }}>
        Kudira
      </span>
    </span>
  );
}
