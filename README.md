# Kudira

Kudira is buy now, pay later underwritten by verified identity instead of collateral. A
buyer's credit limit is derived from a bank-verified Cleanverse A-Pass rather than from a
deposit, so the merchant is paid in full at checkout while Kudira carries the credit risk.

Built for the Cleanverse Build: Trusted Assets hackathon, DeFi track. Live on Base Sepolia.

## Why Cleanverse is load-bearing

The honest test of an integration is what happens when you remove it.

Uncollateralised lending against an anonymous wallet does not work, and no amount of
on-chain cleverness fixes it. Credit limits would have to be inferred from wallet history,
which anyone can manufacture. One person could open unlimited wallets and draw unlimited
credit from each. Default would cost a borrower nothing but a discarded keypair. The only
safe design left is to demand collateral, and a loan secured by collateral is not buy now,
pay later. It is a pawnshop.

A-Pass is bank-verified, wallet-bound, non-transferable and revocable. That is what lets a
credential carry risk that collateral would otherwise have to. Remove Cleanverse from
Kudira and you do not get a degraded product. You get nothing.

## Settlement asset: KUSDC is a CVA we issued

Kudira settles in **KUSDC** (`0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E`), a **CVA
(Cleanverse Verified Asset)** we issued through the documented `/atoken/launch` path
(Method A of the Cleanverse Compliance Protocol (CCP) CVA integration guide) under our
Issue Member scope. A CVA is CCP's native compliant-asset standard: an ERC20 whose every
transfer is gated through Cleanverse identity verification. This is a first-class issuance
path, not a workaround. We hold `DEFAULT_ADMIN_ROLE` on KUSDC and control its supply. We do
not present it as a Cleanverse-operated asset like aUSDC; we present it as our own CVA,
which is exactly what the launch path produces.

The one thing to take from this section: **we can mint KUSDC, but we cannot mint past a
credential check.** The gate is Cleanverse's, not ours. A transfer to an address without a
valid A-Pass reverts inside the token, before any balance moves, and nothing we control
changes that. Controlling the supply of an asset is not the same as controlling who is
allowed to hold it.

We did this because Cleanverse's Base institution faucet has been unable to dispense since
24 July 2026. The faucet's sending wallet `0xc448042edac1899b023caa0e9da5e4a8833de873`
holds 0.199994 origin USDC against requests denominated in whole units, so a `usdc` request
reverts `InsufficientBalance()`. That same wallet holds no A-Pass for aUSDC, so an `ausdc`
request reverts `NoAPass`, which is aUSDC's own gate refusing the faucet. Both failures are
upstream and neither is fixable from our side. With no route to aUSDC, a live on-chain
demonstration needed a settlement asset we could actually supply, and issuing one is a
first-class Issue Member capability.

What matters is that this changes the issuer and nothing else. KUSDC carries the same rule
as aUSDC, `min_tier 5` compared strictly greater, and it is gated identically on-chain for
both sender and recipient. Every address in the money path was verified at `verify_apass`
code 4 against KUSDC before any funds moved, and the merchant dashboard re-runs that check
live against a wallet generated at the moment you press the button.

## Live deployment

Base Sepolia, chain ID 84532.

| Contract | Address |
|---|---|
| KudiraPool | `0x4a898781AFAd85BE7103126952BcBbFCCC24199e` |
| MerchantRegistry | `0x05e2A2473e710435484f6B3b288677618E95bB15` |
| CreditLine | `0x49cD6c00EC00116Eed598b8e07f1B0D7A4805cBE` |
| InstallmentPlan | `0xb4c055e7e880A684F9276435BDc12d25577d39D8` |
| KUSDC (settlement asset) | `0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E` |

The pool is registered as a Cleanverse compliance pool. `validator/grant` and
`validator/register` both verify an EIP-191 signature over `lowercase(chain) +
lowercase(address)` against the pool's on-chain `owner()`, which is why `KudiraPool` is
`Ownable` from its first commit. Registration transaction
`0x607475d38a3b956c2af19e897abb6643960ebe0c106a4e9951e6a6d4c5900944`, confirmed by
`validator/is_register` returning true for the pool address.

Governance and operations are separate keys. `owner()` signs the validator registration,
moves liquidity and onboards merchants. `operator()` originates plans and records defaults
and can do nothing else. The operator can create debt but cannot withdraw funds, change
policy, or add a payee.

## The verified run

A full origination executed live on Base Sepolia, reconstructed here from on-chain events
rather than from script output.

| # | block | tx | what | status |
|---|---|---|---|---|
| 1 | 44998817 | `0x6c8f6abba0bd988c47ae2d70a301f0f7a20847af07c4e67c9ee7a4e7732d15f9` | negative test: originate at subTier 5 reverts `BorrowerDelinquent` | **expected-failed** |
| 2 | 44999037 | `0x1aeb97fe1b0fae0f0bb6bdce5eb7460e6813655641e4b842dc5902660504e3f6` | originate, merchant paid 130.00 in full in the same transaction | success |
| 3 | 44999051 | `0x3b743db871fb8218b7b1ed2c03b71991e4077362fd02496fadfe94e1e9d12a1d` | borrower approves the pool, once, at signing | success |
| 4 | 44999086 | `0xc0707bf6395c514e685b5825ad87ba0fccd7895439822475d8ac98f915fd8d3a` | collect 1, grade 50 to 55 | success |
| 5 | 44999132 | `0xd49887f31f37da57e0da4c4b66c1b922229edf72c26addf648bdb9ea085f4393` | collect 2, grade 55 to 60 | success |
| 6 | 44999176 | `0xe3b7b271896acfb51ab2626665d6442ea8e5ab58d211554b38a4db5f83791d70` | collect 3, grade 60 to 65 | success |
| 7 | 44999221 | `0x925c1751bc0fbef9c69d4bfeb4e11ce9a80279afacbc625cebf0f48beeda66a7` | collect 4, grade 65 to 70 | success |

The first transaction is a deliberate negative test and its failure is the point. The
borrower's A-Pass was set to subTier 5, below the delinquency floor of 10, and the
origination reverted on-chain with `BorrowerDelinquent`. A reverted transaction emits no
logs, so it has to be fetched by hash rather than found in a log sweep.

The grade transitions in rows 4 through 7 are decoded from the
`OnTimeInstallmentsRecorded` events inside each collect, not inferred from the final
number. Final state, read fresh from the chain: grade 70, band `A-`, limit 700.00,
`wasEverLate` false, plan status Completed, and the pool restored to exactly its starting
liquidity because the same capital recycled through the plan.

## Integration surface

Four Cleanverse modules are load-bearing, in the sense that removing any one of them
breaks something Kudira cannot replace.

**A-Pass as underwriting input.** `query_apass` returns tier, subTier, status and
expiration for a wallet. Kudira reads standing only, never documents or account numbers.
The credit grade is the A-Pass subTier, and no plan may extend to or past the credential's
`expirationTime`, which is enforced in `InstallmentPlan.create` and reverts if violated.
Credit is only safe while the credential backing it is live.

**A-Pass as credit record.** Repayment behaviour is written back through `generate_apass`
with `override: true`, which updates the record in place. On-time payments raise the
subTier by 5 each, a default lowers it by 20, both saturating. The penalty is deliberately
a downgrade rather than a freeze: `update_status` would lock the person out of every
service on the Cleanverse network, which is disproportionate for a missed installment and,
worse, would remove their ability to transfer the asset they need in order to cure the
debt. A penalty must not destroy the means of repayment.

**The CCP Validator compliance pool.** KudiraPool integrates the Cleanverse Compliance
Protocol (CCP) as a single-contract lending pool, the first use case its own validator
guide lists: "verify borrower CVI to filter compliant borrowers." The on-chain contract
behind the Validator module is CCP's `IAPassComplianceValidator`, live on Base Sepolia at
`0xaC7e5179C2C7f03f209136886c172eb34F161792`. KudiraPool is registered through
`validator/grant` and `validator/register`; `validator/verify` answers whether a wallet
satisfies the pool's rule, and its on-chain twin `complianceVerify(pool, wallet)` returns
the same answer to anyone who reads it. The validator holds our rule on-chain:
`getRulesV2(pool)` returns `(minTier 5, minSubTier 0, no country restriction)`, exactly the
`min_tier 5` we set. Our contract also mirrors that rule in `satisfiesRule`, using strictly
greater than rather than greater than or equal, because that is what Cleanverse does. A
mirror can drift, so the checkout path calls both and surfaces any disagreement rather
than silently trusting one.

**CVA settlement.** Every transfer of the settlement CVA is gated on-chain against A-Pass
standing for both parties. This is not something Kudira enforces; it is enforced by the CVA
whether we like it or not.

## What we found

Four days of building against a live sandbox surfaced things that no amount of local
testing would have.

**The one-second window.** The grade ladder rewards on-time payments, and auto-debit could
never earn that reward. `collect()` requires `amountDueNow > 0`, which requires
`block.timestamp >= due`. On-time was defined as `block.timestamp <= due`. The intersection
is a single instant, and auto-debit fires *when* an installment falls due, so its
transaction necessarily mines at or after that timestamp. On the live run every collect
landed 8 seconds late and the grade never moved. The tests did not catch this and could
not have: every reward test warped to precisely `dueDateOf(planId, i)`, landing on the only
timestamp where the reward fires. A green suite was asserting against a moment a real chain
can never produce. The fix is a grace period, proportional to the payment interval and
stored per plan so that a later policy change cannot retroactively rewrite the terms of a
live loan. Found by running on a live chain, not in tests.

**The invisible aUSDC gate.** The token's ABI shows no sign that it gates transfers. There
is no `paused()`, no `canTransfer()`, no registry address in its bytecode. Reading the
interface gives a confident and completely wrong answer. The check lives inside `_update`
behind ERC-7201 namespaced storage, and it reverts `NoAPass(address)` naming the offending
party *before* the balance check, so a failing transfer never looks like insufficient
funds. We only found it by simulating real transfers with `eth_call` and state overrides.
Our test suite settles against a mock that reproduces this exactly, including the error
selector, because an unrestricted mock lets every test pass while production reverts on its
first transfer.

**The TLS post-quantum handshake.** Node 24 ships OpenSSL 3.5, whose default TLS 1.3 group
list leads with the post-quantum hybrid `X25519MLKEM768`. The Cleanverse edge silently
drops those ClientHellos: TCP connects, then the handshake times out with no error worth
reading. Every request from Node failed while curl succeeded, which sends you looking in
entirely the wrong place. Restricting the offered groups to classical curves fixes it and
still negotiates TLS 1.3. The likely mechanism is that the ML-KEM key share pushes the
ClientHello past one MTU and something on the path drops the fragmented hello.

**Credentialing is not registration.** A merchant needs two separate approvals that look
like one. A Cleanverse credential lets an address hold the settlement asset. Registry
activation lets the pool pay it. Having one without the other fails at origination with
`MerchantNotActive`, and the two are granted by different keys: registration is
`onlyOwner`, origination is `onlyOperator`.

**The Travel Rule indexing boundary.** `download_travel_rule` returns `TR_001 Transaction
not found` for our settlements, and the reason is precise rather than a dead end. The same
call with another institution's wallet returns `CV_100 Wallet not found for this customer`.
That contrast isolates the cause: ownership scoping passes and only the transaction lookup
fails. Travel Rule reporting is bound to Cleanverse's indexed settlement flow, and KUSDC,
a CVA with no deposit pair, sits outside it. Settle in aUSDC and the record
generates. The compliance layer is not missing; our asset is outside its index. The
merchant dashboard calls the live endpoint and renders that explanation next to the actual
response, because a live failure with a correct diagnosis is worth more than a mocked PDF.

## Repository

```
contracts/       Solidity, Foundry. 116 tests.
app/             Next.js frontend, buyer and merchant routes.
kudira-recon/    Sandbox probes, deployment and verification scripts.
  ARCHITECTURE.md  The spec. Section 0 is empirically verified, not assumed.
  design/          Claude Design bundles and TOKENS.md.
```

## How to run it

Contracts, from `contracts/`:

```bash
forge test                                   # 116 tests, no network needed
RUN_FORK_TESTS=1 forge test --threads 1      # against a Base Sepolia fork
```

Frontend, from `app/`:

```bash
pnpm install
cp .env.example .env.local                   # add your Cleanverse credentials
pnpm dev
```

`CLEANVERSE_API_KEY` is the AES key used to encrypt write bodies. It is read only in
`lib/cleanverse/server.ts`, which is marked `server-only`, so importing it from a client
component is a build error rather than a leak. It must never carry a `NEXT_PUBLIC_` prefix,
which would inline it into the browser bundle.

Sandbox scripts, from `kudira-recon/`:

```bash
npm run pulse                                # mint pipeline health, both chains
node scripts/verify-run.js                   # rebuild the run table from chain events
```

Deployment and any transaction-sending script requires a funded key in a Foundry keystore.
The deploy script asserts `block.chainid == 84532` and refuses any settlement asset that
lacks bytecode or does not report exactly 6 decimals.
