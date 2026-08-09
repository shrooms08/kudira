# Kudira · One-Page Summary

**Compliance-native buy now, pay later.** DeFi track. Live on Base Sepolia.

Live app: https://kudira-fi.vercel.app · Repo: https://github.com/shrooms08/kudira
Demo: https://youtu.be/XS926c6qZ8g

---

## Problem

Buy now, pay later works because the lender knows who you are. Miss a payment and
it follows you. On an anonymous chain nothing follows you, so a defaulter opens a
new wallet and starts again.

That is why on-chain lending converged on overcollateralization: deposit 150 to
borrow 100. It is not a design preference, it is what is left when you cannot
identify a borrower. And a loan secured by more than the loan is worth is a
pawnshop, not credit. If you already had the 150, you would not need the loan.

BNPL is the one consumer credit primitive that cannot exist without identity. The
buyer receives goods before paying, and the only thing securing the loan is an
identity they cannot discard.

## Solution

Kudira underwrites uncollateralized credit against a Cleanverse Verified Identity
credential instead of a deposit.

A buyer checks out. Kudira reads their credential and gets back a tier, a
standing and an expiry, never a name, a document or an account number. That
standing is the credit limit. The merchant is paid in full **in the same
transaction as origination**, so they carry no credit risk and wait for nothing.
The buyer approves once and each installment is auto-debited on its due date.

The grade is the A-Pass `subTier`, an integer 0 to 99 held on-chain. **Limit =
subTier × 10.** An on-time installment is +5, a default is −20, both saturating.
Below 10 no new plans originate.

A default lowers Kudira's own grade. It does not freeze the credential. Freezing
would lock the borrower out of every service on the Cleanverse network including
the ability to repay us. A lender that blocks repayment has mispriced its own
incentives.

## CVI · CVA integration points

Every claim below is a public read on Base Sepolia.

**CVI, the underwriting input.** `query_apass` returns tier, subTier, standing
and expiry; the credential determines the limit and the schedule, and no plan may
extend past the credential's expiry. Repayment behaviour is written back to
subTier via `generate_apass` with `override`, so the grade travels with the
person rather than living privately in our database. Grade transitions are proven
on-chain: 50 → 55 → 60 → 65 → 70 across four collected installments.

**CVA, the settlement asset.** Settlement is in KUSDC
(`0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E`), a CVA issued under our Issue
Member scope through the documented Launch CVA path, after Cleanverse's Base
faucet stopped dispensing aUSDC on 24 July. It carries the same `min_tier 5`
rule as aUSDC and is gated identically on **both** sides of every transfer,
inside `_update`, before any balance check. We can mint KUSDC. We cannot mint
past a credential check. The gate is Cleanverse's, not ours.

**CCP, the compliance gate.** KudiraPool is registered with the CVI Compliance
Validator (`0xaC7e5179C2C7f03f209136886c172eb34F161792`) as a Pattern 2
single-contract lending pool. `complianceVerify(pool, wallet)` is read **on-chain**
at origination alongside the REST `validator/verify` call, and the dashboard shows
both answers side by side for three wallets, one of which is generated at the
moment the button is pressed. If the two ever disagree the UI says so rather than
picking one. `getRulesV2(pool)` returns `(0x0000, 0x0000, 5, 0, 0)` and
`isRegistered(pool)` returns true, so our policy is stored in Cleanverse's own
contract, not asserted by us.

**Where the integration ends, and why.** Travel Rule reporting is bound to
Cleanverse's indexed settlement flow. We proved a real customer-to-customer aUSDC
transfer generates a report, and that a mint from `address(0)` never will because
it has no originator. KUSDC sits outside the index, so the dashboard shows the
live `TR_001` response and explains it rather than hiding it.

## Deployed chains

**Base Sepolia, chainId 84532.**

| | |
|---|---|
| KudiraPool | `0x4a898781AFAd85BE7103126952BcBbFCCC24199e` |
| CreditLine | `0x49cD6c00EC00116Eed598b8e07f1B0D7A4805cBE` |
| InstallmentPlan | `0xb4c055e7e880A684F9276435BDc12d25577d39D8` |
| MerchantRegistry | `0x05e2A2473e710435484f6B3b288677618E95bB15` |
| KUSDC (CVA) | `0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E` |
| CCP validator | `0xaC7e5179C2C7f03f209136886c172eb34F161792` |

116 Foundry tests. Separation of duties on-chain: the operator can create debt
but cannot add a payee or withdraw liquidity; owner and operator are different
keys. Contracts were also verified on Monad testnet before we moved to Base.

## Scalability

Kudira is merchant-agnostic by construction. `MerchantRegistry` supports
arbitrary merchants and origination takes the merchant as a parameter, so adding
a shop is a credential plus a registry write, not a redeploy. Installment count
and cadence are origination parameters rather than hardcoded product decisions,
and a down payment at checkout is the same call with the first installment
settled immediately.

What scales next: an indexer in place of `planCount` iteration, self-serve
merchant onboarding, per-merchant dashboard authentication, and a liquidity layer
where third-party lenders fund the pool and earn on repayments. A first-time
borrower's limit is currently seeded from their credential at origination, so the
underwriting preview should read the A-Pass directly rather than the on-chain
account.

---

*Take CVI out and the limit has to be inferred from wallet history anyone can
manufacture, one person opens unlimited wallets, and default costs a discarded
keypair. Removing Cleanverse does not degrade Kudira. It deletes it.*
