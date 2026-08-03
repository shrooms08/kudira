To: isaac@cleanverse.com
Subject: Kudira, Trusted Assets submission (DeFi track)

Hi Isaac,

Kudira is compliance-native buy now, pay later. A buyer's credit limit comes from
a bank-verified Cleanverse A-Pass instead of collateral, so the merchant is paid
in full at checkout while Kudira carries the credit risk. It is live on Base
Sepolia, registered as a Cleanverse compliance pool.

  Live app:    [LIVE URL]
  Repository:  [REPO URL]
  Demo video:  [DEMO VIDEO URL]
  Pitch deck:  in the repo at design/pitch.pdf

Deployed on Base Sepolia (chain 84532):

  KudiraPool         0x4a898781AFAd85BE7103126952BcBbFCCC24199e
  CreditLine         0x49cD6c00EC00116Eed598b8e07f1B0D7A4805cBE
  InstallmentPlan    0xb4c055e7e880A684F9276435BDc12d25577d39D8
  MerchantRegistry   0x05e2A2473e710435484f6B3b288677618E95bB15
  Settlement asset   0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E  (KUSDC)

The pool is registered through validator/register and its rule is enforced live
by validator/verify. A full origination ran on-chain: the merchant paid in one
transaction, four installments auto-debited, the borrower's grade climbing 50 to
70 as it repaid, plus a deliberate negative test that reverts BorrowerDelinquent.
The seven transaction hashes are in the README.

One disclosure worth making plainly. We settle in KUSDC, an A-Token we issued
ourselves under our Issue Member scope, because the Base institution faucet has
been unable to dispense aUSDC since 24 July. KUSDC carries the same min_tier 5
rule as aUSDC and is gated identically on-chain for both parties. We control its
supply but not its credential gate: a transfer to an address without a valid
A-Pass reverts inside the token, and nothing we control changes that. The README
documents the faucet issue in detail, along with four other findings from
building against the live sandbox.

The deck and README carry the rest. Happy to walk through any of it.

Thanks,
[YOUR NAME]
[YOUR CONTACT]
