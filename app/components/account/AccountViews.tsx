import { Amount, Card, Divider, Eyebrow, GradeBadge } from "@/components/brand/Primitives";
import type { Plan, Standing } from "@/lib/chain";
import { LADDER, formatAmount, formatDate, formatDuration, formatGrade } from "@/lib/format";
import { MERCHANT_NAME, PLAN_STATUS } from "@/lib/contracts";

/// The next payment due across all active plans, or null when nothing is owed.
export function NextPayment({ plans }: { plans: Plan[] }) {
  const active = plans.filter((p) => p.status === 1);
  const next = active
    .filter((p) => p.nextDueDate > 0n)
    .sort((a, b) => Number(a.nextDueDate - b.nextDueDate))[0];

  if (!next) {
    return (
      <Card>
        <Eyebrow>Next payment</Eyebrow>
        <div style={{ marginTop: 12, fontFamily: "var(--font-source-serif)", fontSize: 28 }}>
          Nothing due
        </div>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink-62)" }}>
          Every plan is settled. Your standing is unaffected.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <Eyebrow>Next payment</Eyebrow>
      <div style={{ marginTop: 12 }}>
        <Amount value={next.installmentAmount} unit="KUSDC" size="hero" />
      </div>
      <p style={{ marginTop: 10, fontSize: 13.5, color: "var(--ink-68)" }}>
        Due {formatDate(next.nextDueDate)} · auto-debit from your wallet
      </p>
      <p style={{ marginTop: 4, fontSize: 12.5, color: "var(--ink-55)" }}>
        Paid within {formatDuration(next.gracePeriod)} of the due date still counts as on time.
      </p>
    </Card>
  );
}

/// Standing: grade, band, limit, and what moves them.
export function StandingCard({ standing }: { standing: Standing }) {
  const nextBand = LADDER.slice()
    .reverse()
    .find((b) => b.min > standing.grade);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <Eyebrow>Standing</Eyebrow>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <GradeBadge band={standing.band} />
            <span className="num" style={{ fontSize: 15, color: "var(--ink-68)" }}>
              subTier {standing.grade}
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <Eyebrow>Available credit</Eyebrow>
          <div style={{ marginTop: 8 }}>
            <Amount value={standing.available} unit="KUSDC" size="large" />
          </div>
          {/* "to spend" would contradict the wallet balance in the footer:
              this is headroom to borrow, not money already held. */}
          <div style={{ fontSize: 11.5, color: "var(--ink-45)", marginTop: 4 }}>
            limit minus what you owe
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Divider />
      </div>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Metric label="Limit" value={`${formatAmount(standing.limit)}`} sub="subTier × 10" />
        <Metric
          label="Outstanding"
          value={formatAmount(standing.outstanding)}
          sub={standing.outstanding === 0n ? "nothing owed" : "across active plans"}
        />
        <Metric
          label="History"
          value={`${standing.completedPlans}`}
          sub={standing.defaults > 0 ? `${standing.defaults} default` : "no defaults"}
        />
      </div>

      <p style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-62)" }}>
        +5 subTier per on-time payment
        {nextBand ? (
          <>
            {" · "}
            <span style={{ color: "var(--amber-ink)" }}>
              {formatGrade(nextBand.band)} at {nextBand.min}
            </span>
          </>
        ) : null}
        {" · "}−20 on a default, both saturating.
      </p>
    </Card>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="num" style={{ marginTop: 6, fontSize: 18, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-55)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

/// The published ladder, with the borrower's current band marked.
export function LadderTable({ grade }: { grade: number }) {
  return (
    <Card>
      <Eyebrow>The ladder</Eyebrow>
      <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-62)" }}>
        On-chain subTier 0–99. Limit is subTier × 10 KUSDC.
      </p>
      <div style={{ marginTop: 14 }}>
        {LADDER.map((row) => {
          const here = grade >= row.min && grade <= row.max;
          return (
            <div
              key={row.band}
              style={{
                display: "grid",
                gridTemplateColumns: "88px 1fr auto",
                gap: 12,
                alignItems: "center",
                padding: "10px 12px",
                margin: "0 -12px",
                borderRadius: "var(--r-input)",
                background: here ? "var(--paper-amber)" : "transparent",
              }}
            >
              <span className="num" style={{ fontSize: 12.5, color: "var(--ink-62)" }}>
                {row.min}–{row.max}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: here ? 600 : 500 }}>
                {formatGrade(row.band)}
                {here ? (
                  <span style={{ color: "var(--amber-ink)", fontWeight: 500 }}> · you are here</span>
                ) : null}
              </span>
              <span className="num" style={{ fontSize: 12.5, color: "var(--ink-62)" }}>
                {row.limitLabel}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/// Active plans and settled history.
export function PlanList({ plans, title }: { plans: Plan[]; title: string }) {
  if (plans.length === 0) return null;
  return (
    <Card>
      <Eyebrow>{title}</Eyebrow>
      <div style={{ marginTop: 12, display: "grid", gap: 0 }}>
        {plans.map((p, i) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "14px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--ink-08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "var(--paper-sunk)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--ink-68)",
                }}
              >
                M
              </div>
              <div>
                <div style={{ fontSize: 14 }}>{MERCHANT_NAME}</div>
                <div style={{ fontSize: 12, color: "var(--ink-55)", marginTop: 1 }}>
                  <span className="num">
                    {p.installmentsCovered} of {p.installments}
                  </span>{" "}
                  paid
                  {p.status === 1 && p.nextDueDate > 0n ? (
                    <> · next {formatDate(p.nextDueDate)}</>
                  ) : (
                    <> · {PLAN_STATUS[p.status]}</>
                  )}
                  {p.everLate ? " · was late" : ""}
                </div>
              </div>
            </div>
            <span className="num" style={{ fontSize: 15 }}>
              {formatAmount(p.status === 1 ? p.outstanding : p.principal)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
