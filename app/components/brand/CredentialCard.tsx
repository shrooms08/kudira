import { CountUp } from "@/components/brand/CountUp";
import { formatAmount, formatGrade } from "@/lib/format";

/// The Kudira lime mark (issuer mark). From the design source, verbatim path.
function KudiraMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" style={{ display: "block", flex: "none", opacity: 0.9 }} aria-hidden>
      <path
        fillRule="evenodd"
        fill="var(--accent)"
        d="M150 72 H362 A78 78 0 0 1 440 150 V362 A78 78 0 0 1 362 440 H150 A78 78 0 0 1 72 362 V150 A78 78 0 0 1 150 72 Z M144 130 H196 V382 H144 Z M262.8 240.9 L372.7 148.7 L349.7 121.1 L239.8 213.3 Z M239.8 298.7 L349.7 390.9 L372.7 363.3 L262.8 271.1 Z"
      />
    </svg>
  );
}

const mono = "var(--font-jetbrains-mono), ui-monospace, monospace";

function Attribute({ children, color = "var(--bone-62)", shape }: { children: React.ReactNode; color?: string; shape: "ring" | "square" | "ring-signal" }) {
  const dot =
    shape === "square" ? (
      <span style={{ width: 8, height: 8, background: "var(--bone-75)", flex: "none" }} />
    ) : (
      <span style={{ width: 9, height: 9, borderRadius: "50%", border: `2px solid ${shape === "ring-signal" ? color : "var(--bone-75)"}`, boxSizing: "border-box", flex: "none" }} />
    );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {dot}
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.06em", color, whiteSpace: "nowrap" }}>{children}</span>
    </div>
  );
}

export type CredentialCardProps = {
  /** Approved-limit figure to display (6-decimal). The screen decides: seeded ->
   *  availableCredit; unrated -> the entitlement the credential grants. */
  limit: bigint;
  subTier: number | null;
  /** on-chain bandOf — only shown when rated. */
  band: string;
  /** on-chain CreditLine.exists. False = fresh borrower, no credit line yet. */
  rated: boolean;
  verified: boolean;
  revoked: boolean;
  /** real reference shown top-right, e.g. the A-Pass cvRecordId. */
  reference?: string;
  /** count the limit up 0 -> value (the checkout underwriting moment). */
  animateLimit?: boolean;
  /** override the card width; height follows the 1.586:1 ID-1 ratio. */
  width?: number | string;
};

/**
 * The credential — issued, not rendered. 1.586:1 ID-1 ratio, 9px weave, the
 * grade debossed into the face.
 *
 * The unseeded case is handled HERE, not per-screen: a fresh borrower has
 * gradeOf 0 and bandOf "delinquent" while their credential says subTier 50.
 * When `rated` is false we show "Not yet rated" and never borrow the delinquent
 * band for a grade of zero.
 */
export function CredentialCard({
  limit,
  subTier,
  band,
  rated,
  verified,
  revoked,
  reference,
  animateLimit = false,
  width = 520,
}: CredentialCardProps) {
  const [whole, cents] = formatAmount(limit).split(".");
  const wholeInt = Number(whole.replace(/,/g, ""));

  // The VERIFIED pill's green is an APPROVED signal, so it only fires once the
  // account is rated. On the unseeded card it drops to neutral bone — the
  // credential's verification is still carried by BANK VERIFIED along the bottom
  // edge, so nothing is lost and green never reads as "approved" next to
  // "Not yet rated".
  const green = rated && verified;
  const warn = rated && !verified;
  const pillBg = green ? "var(--signal-14)" : warn ? "var(--warn-14)" : "rgba(245,245,240,0.06)";
  const pillFg = green ? "var(--signal)" : warn ? "var(--warn)" : "var(--bone-62)";
  const pillDot = green ? "var(--signal)" : warn ? "var(--warn)" : "var(--bone-55)";

  return (
    <div style={{ width, maxWidth: "100%", flex: "none" }}>
      <div
        className="ku-card-circles"
        style={{
          position: "relative",
          aspectRatio: "1.586 / 1",
          borderRadius: "var(--r-card)",
          border: "1px solid var(--line-09)",
          boxShadow: "var(--shadow-card)",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "var(--bone)",
        }}
      >
        {/* Top edge: A-PASS + verified pill (left), issuer ref + mark (right) */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", color: "var(--bone-50)" }}>A-PASS</div>
            <div
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                alignItems: "center",
                gap: 7,
                background: pillBg,
                borderRadius: "var(--r-pill)",
                padding: "5px 11px 5px 8px",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: pillDot, flex: "none" }} />
              <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", color: pillFg }}>
                {warn ? "UNVERIFIED" : "VERIFIED"}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {reference ? (
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", color: "var(--bone-50)", textAlign: "right" }}>{reference}</div>
            ) : null}
            <KudiraMark size={30} />
          </div>
        </div>

        {/* Bottom edge: limit (left), grade / rating (right) */}
        <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 66, letterSpacing: "-0.04em", lineHeight: 0.9, fontVariantNumeric: "tabular-nums" }}>
                {animateLimit ? <CountUp to={wholeInt} /> : whole}
              </div>
              <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 28, color: "var(--bone-50)", fontVariantNumeric: "tabular-nums" }}>.{cents}</div>
            </div>
            <div style={{ fontSize: 13, color: "var(--bone-62)" }}>
              {rated ? "Approved limit · KUSDC" : "Limit on approval · KUSDC"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flex: "none" }}>
            {rated ? (
              <div className="num deboss" style={{ fontWeight: 700, fontSize: 62, lineHeight: 0.85, letterSpacing: "-0.03em" }}>
                {formatGrade(band)}
              </div>
            ) : (
              <div style={{ fontFamily: mono, fontSize: 15, lineHeight: 1, color: "var(--bone-62)", textAlign: "right", letterSpacing: "0.01em" }}>
                Not yet rated
              </div>
            )}
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: "var(--bone-42)" }}>
              {subTier !== null ? `SUBTIER ${subTier}` : "SUBTIER —"}
            </div>
          </div>
        </div>

        {/* Struck attributes along the bottom */}
        <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "nowrap", borderTop: "1px solid var(--line-08)", marginTop: 22, paddingTop: 14 }}>
          <Attribute shape="ring">BANK VERIFIED</Attribute>
          <Attribute shape="square">NON-TRANSFERABLE</Attribute>
          {revoked ? (
            <Attribute shape="ring-signal" color="var(--warn)">REVOKED</Attribute>
          ) : (
            <Attribute shape="ring-signal" color="var(--signal)">NOT REVOKED</Attribute>
          )}
        </div>
      </div>
    </div>
  );
}
