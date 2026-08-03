# Kudira — Architecture Specification

Compliance-native buy now, pay later on the Cleanverse stack.
Cleanverse Build: Trusted Assets Hackathon, DeFi track.

Revision 3 — Aug 3, 2026. Phase 0 complete, Phase 1 contracts written.
Submission deadline Aug 9, 23:59 UTC, by email to isaac@cleanverse.com.

---

## 0. Verified facts

Every value below was confirmed empirically against the live sandbox, not assumed
from docs.

| Fact | Value | How verified |
|---|---|---|
| Integration role | **Issue Member** | `validator/is_register` returned `0000` |
| **Chain (primary)** | **Base Sepolia**, chainId 84532 (`0x14a34`) | §0.1 |
| Chain (optional bonus) | Monad testnet, 10143 | contracts verified, mint pipeline stalled |
| aUSDC | `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` | `symbol()`=`aUSDC`, `decimals()`=6 |
| aUSDC total supply | 1,010,551.611006 | `eth_call` |
| AccessCore | `0x8F118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC` | impl slot, chain-specific bytecode |
| A-Pass registry | `0xbA82D189540CaC9DC6FF46B6837CaC1BFdEC58B9` | impl slot, chain-specific bytecode |
| Sandbox base URL | `https://uatapi.cleanverse.com/api/cooperate` | docs |
| AES key | The value labelled "Sandbox API key" in the welcome email | **PROVEN**, §0.2 |
| aUSDC transfer gate | **Both parties need an A-Pass** | §0.4 — proven on-chain |

Note: aUSDC's `name()` returns `"Access USDC"`, not `"aUSDC"`. Label only. Never
assert on `name()`.

The three contract addresses are identical on Base and Monad (deterministic
deploy). Only the RPC URL, chainId, and the `chain` string differ.

### 0.1 Why Base, not Monad

The hackathon page states projects may be built on any integrated network, so
there is no scoring penalty for not using the sponsor chain. Base minting is
healthy; Monad's write path has been stalled since 06:23 UTC with no team landing
a record. Every doc example uses `base`. Monad remains an optional second deploy.

### 0.2 Phase 0 gate results

| Gate | Status | Evidence |
|---|---|---|
| Role | PASS | Validator module reachable |
| Chain + aUSDC | PASS | `symbol()`/`decimals()` correct; impl slots hold real bytecode |
| TLS from Node | PASS | §0.3 |
| AES key | PASS | 4/4 writes on Base with server-echoed customerIds |
| Write path | PASS | HTTP/2 required; read-back verification |

**AES proof method (the bar for all future write verification):** fresh random
wallet per run, `KUDIRA`-prefixed customerId, pre-write not-found check,
ownership confirmed via `query_apass_list` on exact customerId + chain + wallet
match. A record is never counted as ours unless we created it.

This bar exists because an earlier proof produced a false positive by reading
another team's pre-existing records (373/374) as its own output. **Never infer
that a write succeeded from a record you did not create.**

### 0.3 Two transport gotchas

**TLS.** Node 24 ships OpenSSL 3.5, whose default TLS 1.3 group list leads with
`X25519MLKEM768`. The Cleanverse edge silently drops those ClientHellos: TCP
completes, then the handshake times out. Any classical group works and still
negotiates TLS 1.3. Likely MTU fragmentation from the ~1.2KB PQ key share.

```js
// src/lib/tls-compat.js — import first in every entrypoint
import tls from "node:tls";
tls.DEFAULT_ECDH_CURVE = "X25519:prime256v1";
```

Process-global, therefore also applies to RPC calls. Intentional and harmless.

**Writes need HTTP/2.** `generate_apass` mints on-chain and outlives the HTTP/1.1
timeout; the server closes the socket at ~15s and aborts before commit. Use
`node:http2` for writes, `fetch` for reads. Confirm success by polling
`query_apass_list`, not by the write response.

### 0.4 aUSDC is credential-gated on both sides

**The single most important integration fact in this document.**

aUSDC enforces A-Pass membership inside `_update`, for sender AND recipient.
Proven by `eth_call` with `stateDiff` overrides against the real token:

| Transfer from a credentialed sender to | Result |
|---|---|
| Bare EOA (no A-Pass) | REVERTS `0xa6725971`, names the recipient |
| Contract without an A-Pass | REVERTS `0xa6725971`, names the recipient |
| EOA holding an A-Pass | SUCCEEDS |
| **Contract holding an A-Pass** | **SUCCEEDS** |

From an uncredentialed sender it reverts naming the sender.

Three traps:

1. **It reverts before the balance check.** A failing transfer never surfaces as
   insufficient balance, so the natural debugging instinct is misleading.
2. **The ABI lies.** aUSDC presents as plain OZ v5 ERC20 + AccessControl + UUPS.
   No `paused()`, no `owner()`, no `accessCore()`, no `canTransfer()`, no
   registry address in the bytecode. The gate lives behind ERC-7201 namespaced
   storage. Reading the ABI gives a confident, wrong "no gating" answer.
3. **`0xa6725971` is not in 4byte.directory.** Nothing will decode it for you.

**Current aUSDC rule** (`/atoken/rules`, poll for changes):

```json
{ "min_tier": 5, "min_sub_tier": 0, "is_black_list": false,
  "countries": [], "allowed_group": "", "allowed_sub_group": "" }
```

`min_tier` here is a **number**, unlike the `tier` **string** in A-Pass records.
Our issued passes default to tier `"50"`, which clears `> 5`. `min_sub_tier: 0`
is unrestricted.

**Consequence:** every address in the money path needs an A-Pass. The pool, every
merchant payout address, every liquidity provider, every borrower. Contracts can
hold A-Passes — four already do on Base.

---

## 1. Open risks

| # | Risk | Impact | State |
|---|---|---|---|
| R1 | Node TLS handshake dropped | Blocker | **RESOLVED** §0.3 |
| R2 | AES key identity unknown | Blocker | **RESOLVED** §0.2 |
| R3 | Shared sandbox, 219+ records visible | PII exposure, ID collisions | Mitigated §6 |
| R4 | Monad mint pipeline stalled | Was blocking | Sidestepped by Base |
| R5 | `registeredAt` has no timezone marker; offset differs per chain | Wrong age math | Never use for business logic |
| R6 | **aUSDC `min_tier` can be changed by Cleanverse via `add_rule`** | Deploy could revert mid-week | Poll `/atoken/rules` in `check-pulse.js` |
| R7 | Foundry mock must mirror the aUSDC gate or tests give false confidence | Silent production failure | **MockAToken required**, §4.2 |

---

## 2. Product model

Buyer holds an A-Pass. Kudira reads its standing to underwrite an installment
plan. Merchant is paid in full immediately in aUSDC. Buyer repays on schedule.
Repayment behaviour writes back to the credential.

Five stages: Verify, Underwrite, Settle, Repay, Enforce.

**Why Cleanverse is load-bearing:** BNPL is uncollateralized by definition.
Against an anonymous wallet the only safe design is to demand collateral, which
is not BNPL. A-Pass is bank-verified, wallet-bound, non-transferable and
revocable, so it can carry the risk that collateral otherwise has to.

---

## 3. Cleanverse integration surface

### 3.1 A-Pass as underwriting input (read)

`POST /query_apass` → `{ tier, subTier, status, group, subGroup, expirationTime,
countries[], currentKycHash, cvRecordId }`

Data-shape traps:
- `tier` is a **string** (`"50"`), `subTier` is an **integer**. So is aUSDC's
  `min_tier` (number). Parse explicitly at every boundary.
- `status` returns `null` in the **list** endpoint. Use single `query_apass`.
- `query_apass` looks up by wallet and does **not** return `customerId`, so it
  can never establish ownership. Use `query_apass_list` for that.
- `expirationTime` is Unix **seconds**.
- Undocumented error sub-codes exist (e.g. `[CN_001]`). Parse the bracketed
  prefix from `message`, never string-match.

### 3.2 A-Pass as credit record (write)

Kudira is an Issue Member, so it issues and updates credentials.

**Confirmed:** the sandbox honours a requested `subTier` (sent 10, stored 10) and
assigns `tier` `"50"` by default.

- `POST /generate_apass` with `subTier` = Kudira credit grade (1-99)
- `override: true` to re-issue on grade change
- `POST /update_status` with `status: 2` to freeze

**Canonical source of truth: the on-chain grade.** A-Pass subTier is the
published copy. Sync is one-way, chain → credential, except at first origination
where a new borrower's grade seeds from their existing subTier. `originate` must
never overwrite an existing on-chain grade from a possibly-stale API read.
Deliberate re-syncs go through owner-only `syncGrade`.

**Policy decision (deliberate):** default penalty is a **subTier downgrade**, not
a freeze. subTier is Kudira's own grade. A freeze locks the person out of every
service on the Cleanverse network, which is disproportionate for a missed
installment and indefensible under questioning. Reserve freeze for confirmed
fraud.

| subTier | Meaning | Credit limit |
|---|---|---|
| 10 | New, unproven | Floor |
| 20-40 | Building | Scales with completed plans |
| 50-70 | Established | Full |
| 80+ | Prime | Max, best terms |
| < 10 | Delinquent | No new originations |

Transitions: on-time completion `+10` (cap 99); default `−20` (saturating).

### 3.3 Validator compliance pool (the differentiator)

KudiraPool registers as an on-chain compliance pool. Issue Member scope; most
teams will not find this module.

1. `POST /validator/grant` — REGISTER_ROLE to the pool contract
2. `POST /validator/register` — register pool with initial rule
3. `POST /validator/set_rule` — **replaces all rules** with one rule
4. `POST /validator/verify` — does this wallet satisfy the pool's rules

**Hard constraint:** `grant` and `register` require `owner_signature`, EIP-191
`personal_sign` over `lowercase(chain) + lowercase(address)`, no separator,
verified against the contract's on-chain `owner()`.

→ **KudiraPool MUST be `Ownable`.** Not retrofittable.

Rule mechanics:
- `min_tier` / `min_sub_tier` are **strictly greater than**, not ≥. `0` = no
  restriction.
- `add_rule` is create-only, rejects duplicates, removal by index.
- **Use `set_rule` for policy changes**, not add/remove juggling.
- Serialize on-chain writes; wait for confirmation before the next mutation.

**Origination must call `validator/verify` as well as the on-chain
`satisfiesRule`.** Our contract mirrors Cleanverse's semantics, and a mirror can
drift. If the two disagree, surface it loudly rather than trusting the copy.

### 3.4 aUSDC settlement

Merchant payout and every installment settle in aUSDC (6 decimals). Both parties
to every transfer need a credential — see §0.4. `POST /verify_apass` gates
receipt: result code `4` = allowed, `2` = no A-Pass, `3` = expired or frozen.

### 3.5 Travel Rule report

`POST /download_travel_rule` returns a real PDF for a transfer txHash.
**This is the demo moment.** A generated compliance report on screen is worth
more to this panel than UI polish.

---

## 4. Contracts

Solidity, Foundry, Base Sepolia.

```
KudiraPool.sol          Ownable. The registered compliance pool.
                        Liquidity, origination, repayment receipt.
CreditLine.sol          Per-borrower: grade, limit, outstanding, history.
InstallmentPlan.sol     Schedule, due dates, late detection.
MerchantRegistry.sol    Merchant onboarding and payout addresses.
```

### 4.1 Roles

- `owner()` — governance, and the address that signs the validator
  `grant`/`register` payloads. Held by `POOL_OWNER`, ideally cold.
- `operator` — calls `originate`. Separated from owner so a single hot key does
  not both sign validator registration and create debt.

Deploy ordering: satellites are deployed owned by the broadcaster, wired, then
ownership transferred. `KudiraPool` is owned by `POOL_OWNER` from construction,
which is what the validator signature checks. Deploying satellites owned by
`POOL_OWNER` up front makes `setPool` revert mid-deploy for any cold or multisig
owner.

### 4.2 Testing against a gated mock

**An unrestricted `MockERC20` will let all tests pass while production reverts on
its first transfer.** `MockAToken` must mirror aUSDC:

- OZ v5 ERC20, 6 decimals
- Settable credential registry with a per-address tier
- `_update` reverts with a custom error naming the offending party if **either**
  sender or recipient lacks a credential
- Reverts **before** the balance check, matching real behaviour
- `min_tier 5`, strictly greater than: tier exactly 5 is rejected, 50 accepted
- Mint and burn exempt (`address(0)` is neither party)

Required tests beyond the original four:

1. Uncredentialed pool cannot receive LP funding
2. Uncredentialed pool cannot pay a merchant
3. Uncredentialed merchant cannot receive settlement — origination fails cleanly
4. Uncredentialed borrower cannot repay
5. Uncredentialed LP cannot fund
6. Tier exactly 5 rejected (token-level `min_tier` boundary)
7. **Origination is atomic.** If merchant payout reverts on a credential check,
   no plan exists, no credit is drawn, no state mutates. Assert full pre-state
   restoration.

Other hard rules already tested: the `min_tier` off-by-one (fuzzed), plans must
end strictly before A-Pass `expirationTime`, grade transitions, delinquency
blocking, dust on the final installment, chainId guard.

---

## 5. Application architecture

```
Browser  ──►  Next.js API routes  ──►  Cleanverse API
   │                                   (reads: fetch)
   │                                   (writes: node:http2 + AES)
   └────────►  Base Sepolia RPC  ──►  KudiraPool
```

**Non-negotiable:** the AES api-key never leaves the server. `.env` only, in
`.gitignore` before the first commit. Never logged, never in a URL, never in a
browser bundle.

Encryption: AES-256-CBC, PKCS#7, IV = 16 zero bytes, key =
`Buffer.from(CLEANVERSE_API_KEY, "base64")` (32 bytes), body sent as
`{"data":"<Base64 ciphertext>"}`.

Every response is HTTP 200. **Success is `code === "0000"`.** Never branch on
HTTP status.

---

## 6. Shared-sandbox handling

219+ A-Pass records are visible and mostly are not ours. Other teams (CleanRail,
others) are actively registering. Assume everything we write is readable by
competitors.

- **No real PII.** Synthetic names and ID numbers only.
- **Namespace every customerId** with `KUDIRA`. 12+ chars, `A-Za-z0-9` only, no
  hyphens. A raw UUID fails validation.
- **Treat `override: true` as dangerous.** Cross-team collision could clobber.
- **Never trust a record you did not create.** Verify customerId + chain + wallet.

---

## 7. Geography

Nigeria is **not** in the Fiat Ramp supported list. Of 63 countries, the only
African entries are Cabo Verde and Mauritius.

Supported markets relevant to the pitch: **Philippines, Brazil, Mexico, Peru,
Malaysia**. Frame the emerging-market argument around Southeast Asia and Latin
America. Same thesis, supported geography, better-researched to a Singapore
panel.

---

## 8. Build plan

| Phase | Target | Deliverable | Gate |
|---|---|---|---|
| 0 | done | Recon, TLS, AES, chain choice | All PASS §0.2 |
| 1 | Mon-Tue | Contracts + Foundry tests against **MockAToken** | All green, incl. the seven §4.2 tests |
| 2 | Wed | Deploy + credential the money path + validator register | §8.1 checklist complete |
| 3 | Thu | A-Pass read path, underwriting, aUSDC settlement | End-to-end origination on-chain |
| 4 | Fri | Merchant checkout + storefront | Purchase completes from connect to signed plan |
| 5 | Sat | Repayment, grade transitions, Travel Rule PDF | Downgrade path demonstrable live |
| 6 | Sun | Demo video, README, submission email | Sent before Aug 9 23:59 UTC |

### 8.1 Phase 2 deploy sequence (order matters)

1. Deploy KudiraPool + satellites (broadcaster-owned, wire, transfer)
2. **Issue an A-Pass to the pool address**, `chain: "base"`, tier clearing `> 5`
3. **`verify_apass` on the pool, confirm code 4** — before any funds move
4. Issue A-Passes to the merchant payout address and the LP address
5. Fund the pool
6. `validator/grant`, then `validator/register`, signed by `owner()`

Steps 2 to 4 are hard prerequisites. Getting the order wrong produces a revert
with an error not in 4byte.directory.

**Scope discipline:** one merchant, one currency, one schedule shape. Depth of
integration over breadth. Anything not touching A-Pass, aUSDC or the Validator is
cut without discussion.

**Merchant onboarding is a product surface, not a registry write.** A merchant
cannot receive settlement without a credential, so onboarding must issue one.
Worth a screen and a beat in the demo.

**Submission is an email, not a portal.** Self-contained: repo link, deployed
URL, demo video, written summary. Draft it in Phase 5.

**Worth including in the README:** the TLS post-quantum finding and the aUSDC
ABI trap. Both are real, both cost nothing, both signal rigour.

---

## 9. What breaks without Cleanverse

The question the judges will ask.

- Credit limit would have to be inferred from wallet history, which any borrower
  can manufacture
- One person opens unlimited wallets and draws unlimited credit
- Default costs the borrower nothing but a discarded keypair
- The only safe design is to demand collateral, which is not BNPL

Removing A-Pass does not degrade Kudira. It deletes it.