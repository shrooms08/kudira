# Kudira contracts

Compliance-native BNPL on the Cleanverse stack. Solidity + Foundry, targeting
**Base Sepolia (chainId 84532)**. See `../kudira-recon/ARCHITECTURE.md` §4.

| Contract | Role |
|---|---|
| `KudiraPool` | **`Ownable`.** The registered compliance pool: liquidity, origination, repayment receipt. |
| `CreditLine` | Per-borrower grade, limit, outstanding balance, history. |
| `InstallmentPlan` | Schedule, due dates, late detection, completion. |
| `MerchantRegistry` | Merchant onboarding and payout addresses. |
| `TierRules` | The Cleanverse strictly-greater-than rule comparison. |

## Settlement asset: KUSDC is our own A-Token, and here is why

Kudira settles in **KUSDC** (`0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E`), an
A-Token **we launched ourselves** via `/atoken/launch` under our Issue Member scope.
It is not a Cleanverse-issued asset and we do not present it as one. We hold
`DEFAULT_ADMIN_ROLE` on it and control its supply.

We did this because **Cleanverse's Base institution faucet has been unable to
dispense since 24 July 2026** — no origin-USDC transfer has settled on Base Sepolia
since then. The cause is on the faucet's side, and is specific:

- the faucet's sending wallet `0xc448042edac1899b023caa0e9da5e4a8833de873` holds
  **0.199994 origin USDC** against requests denominated in whole units, so `symbol:
  "usdc"` reverts `InsufficientBalance()`
- that same wallet holds **no A-Pass** for aUSDC — `verify_apass` returns **code 2**
  ("apass not exist") — so `symbol: "ausdc"` reverts `NoAPass(0xc448042e…)`,
  the token's own gate refusing the faucet

With no route to aUSDC, a live on-chain demo needed a settlement asset we could
actually supply. Issuing one is a first-class Issue Member capability, so we used it.

**KUSDC is gated identically to aUSDC.** Same rule (`min_tier 5`, `min_sub_tier 0`,
strictly greater), same on-chain enforcement for **both** sender and recipient, same
`NoAPass(address)` revert. Every address in our money path holds an A-Pass verified
against KUSDC at `data.code == 4` before any funds moved. Nothing about the
compliance integration is weakened by the swap; only the issuer differs.

`KudiraPool.asset` is **immutable** — the settlement token is fixed at construction.
Choosing it wrongly costs a full redeploy plus re-credentialing and re-registration.
`SETTLEMENT_ASSET` overrides the default at deploy time, and the script refuses any
asset without bytecode or without exactly 6 decimals.

## What we found

### The one-second window: auto-debit could never earn the reward

The grade ladder rewards `+5 subTier` per instalment paid on time. On a live Base
Sepolia run, four instalments were collected, all four settled correctly, and the
grade did not move at all — it sat at 50 across the entire plan instead of climbing
to 70.

The cause was an interval with no width:

- `collect()` requires `amountDueNow > 0`, which requires `block.timestamp >= due`
- "on time" was `!late`, and `_isLate` was `block.timestamp > due`

so the only instant at which a payment was both **collectable** and **on time** was
the exact second `block.timestamp == due`. Auto-debit fires *when* an instalment
falls due, so its transaction necessarily mines at or after that timestamp. On the
live run every collect landed **8 seconds** after its due date. Every
`PaymentRecorded` carried `late = true`; zero `OnTimeInstallmentsRecorded` events
were emitted. The reward was unreachable by construction.

**The tests did not catch it, and could not have.** Every reward test warped to
precisely `vm.warp(plans.dueDateOf(planId, i))` — landing exactly on the one second
where the reward fires. They were green, and they were asserting against the only
timestamp a real chain can never hit. A passing test suite said the feature worked;
a live chain said it had never worked once.

**The fix is a grace semantic.** On time now means paid before `due + gracePeriod`,
where grace is `dueEvery / 10`, floored at 60 seconds, computed at origination and
**stored per plan**. Proportional rather than absolute so it scales with the
schedule: fortnightly instalments get ~1.4 days, matching the everyday convention
that a payment is on time any time on its due date. An absolute one-day default
would have exceeded a short demo cadence entirely, making "late" unreachable and
silently disabling the default path. Grace is stored per plan because a later policy
change must never retroactively rewrite the terms of a live loan.

The reproducing test (`test/OnTimeGrace.t.sol`) was written to **fail against the old
code** — a test that passes against the bug proves nothing. It pins the live case
(collect at `due + 8s` four times reaches grade 70) and keeps two guardrails: a
genuinely late payment still earns nothing, and `markDefault` is still reachable.

Found by running on a live chain, not in tests. That is the whole lesson.

### Two more that only a live chain surfaced

**aUSDC gates transfers on-chain, for both parties.** The token's ABI shows no sign
of it — no `paused()`, no `canTransfer()`, no registry address in its bytecode. The
check lives in `_update` behind ERC-7201 namespaced storage. Reading the interface
gives a confident, wrong answer. It reverts `NoAPass(address)` (`0xa6725971`) naming
the offending party, **before** the balance check, so a failing transfer never looks
like insufficient funds.

**Credentialing and registration are two different things.** An A-Pass lets a
merchant *hold* the settlement asset; `MerchantRegistry` is what lets the pool *pay*
them. Having one without the other fails at origination with `MerchantNotActive`.

## Two rules that are not negotiable

**`KudiraPool` must stay `Ownable`.** Cleanverse `validator/grant` and
`validator/register` verify an EIP-191 signature over
`lowercase(chain) + lowercase(address)` against the pool's on-chain `owner()`.
Removing `owner()` means a full redeploy.

**Validator rules are strictly greater than, never `>=`.** A borrower whose
`subTier` exactly equals `min_sub_tier` is rejected. `TierRules.satisfies`
encodes this and `MinTierOffByOne.t.sol` pins it down. Gating on `>=` anywhere
would approve borrowers the compliance layer turns away.

## Commands

```bash
forge build
forge test
forge test --match-path test/MinTierOffByOne.t.sol -vv

# Deploy (asserts chainid == 84532 and that aUSDC has bytecode)
forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

`POOL_OWNER` overrides the pool owner; it may be a cold wallet or multisig, since
the script wires the satellites before handing ownership over. Whichever key owns
the pool is the key that must produce the validator `owner_signature`.

Dependencies live in `lib/` (forge-std, openzeppelin-contracts v5.4.0) and are
resolved through the remappings in `foundry.toml`.
