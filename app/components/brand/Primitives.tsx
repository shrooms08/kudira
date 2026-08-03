import { formatGrade, splitAmount } from "@/lib/format";

/// Uppercase section label. 10-11px + 0.18em tracking — the signature treatment.
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

/// A figure. ALWAYS Plex Mono. `size="hero"` sets the cents smaller than the
/// major part, which is how every large amount is typeset in the design.
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
        {unit ? <span style={{ color: "var(--ink-45)" }}> {unit}</span> : null}
      </span>
    );
  }
  const majorSize = size === "hero" ? 76 : 34;
  const minorSize = size === "hero" ? 30 : 18;
  return (
    <div className="num" style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
      <span style={{ fontSize: majorSize, letterSpacing: "-0.04em", lineHeight: 1 }}>{major}</span>
      <span style={{ fontSize: minorSize, letterSpacing: "-0.02em" }}>.{minor}</span>
      {unit ? (
        <span style={{ fontSize: minorSize, color: "var(--ink-45)", marginLeft: 8 }}>{unit}</span>
      ) : null}
    </div>
  );
}

/// The letter grade. Rendering goes through formatGrade so A− is drawn with
/// U+2212 in one place only — see lib/format.ts.
export function GradeBadge({ band, subdued = false }: { band: string; subdued?: boolean }) {
  const delinquent = band === "delinquent";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: delinquent ? undefined : 30,
        padding: delinquent ? "4px 12px" : "4px 10px",
        borderRadius: "var(--r-pill)",
        background: delinquent ? "var(--ink-08)" : subdued ? "var(--paper-sunk)" : "var(--paper-amber)",
        border: `1px solid ${delinquent ? "var(--ink-12)" : "rgba(233,161,59,0.35)"}`,
        color: delinquent ? "var(--ink-62)" : "var(--amber-ink)",
        fontSize: delinquent ? 11 : 13,
        fontWeight: 600,
        letterSpacing: delinquent ? "0.06em" : "0",
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
  return <div style={{ height: 1, background: "var(--ink-08)" }} />;
}

/// Raw API payload, shown verbatim. Used where the actual response IS the
/// evidence and paraphrasing it would weaken the claim.
export function RawJson({ value }: { value: unknown }) {
  return (
    <pre
      className="num"
      style={{
        fontSize: 11,
        lineHeight: 1.6,
        background: "var(--ink)",
        color: "var(--white-72)",
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

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-source-serif), Georgia, serif",
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "-0.02em",
      }}
    >
      Kudira
    </span>
  );
}
