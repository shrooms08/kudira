#!/usr/bin/env bash
# Full live origination on Base Sepolia, start to finish, in one run.
#
# Claude cannot send transactions (the keystores are password-encrypted and only
# you hold the password), so this script exists to be run by YOU in one go. It
# asks for the keystore password once, holds it in a shell variable, and never
# writes it to disk.
#
# It prints every transaction hash as it goes.
#
#   BORROWER=0x... ./scripts/live-origination.sh
#
# Requires: the borrower is an EOA whose key is in the `kudira-borrower` keystore
# account and which holds a little Base Sepolia ETH (one approve tx). A CONTRACT
# cannot be the borrower for auto-debit — it can never call approve().

set -euo pipefail
cd "$(dirname "$0")/.."

RPC=${RPC:-https://sepolia.base.org}
POOL=0x4a898781AFAd85BE7103126952BcBbFCCC24199e
KUSDC=0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E
MERCHANT=0xE8D7b7CEDC7b114D56E7828C7179c6a9b9EEe06D   # Manila Coffee Roasters
# Payout defaults to the merchant's own address (the one we credentialed).
MERCHANT_PAYOUT=${MERCHANT_PAYOUT:-0xE8D7b7CEDC7b114D56E7828C7179c6a9b9EEe06D}
REGISTRY=0x05e2A2473e710435484f6B3b288677618E95bB15
TREASURY=0x021Fed3a7d7367B3d4Da7812B38355014AFc808F
OPERATOR=0x0c9CE1fcd01C997A51442bB296FfC960C59bEfdd

BORROWER=${BORROWER:?set BORROWER=0x... (an EOA in the kudira-borrower keystore)}
BORROWER_CUSTOMER_ID=${BORROWER_CUSTOMER_ID:?set BORROWER_CUSTOMER_ID to the customerId Claude issued}

# Demo economics. 130.00 KUSDC over 4 installments of 32.50.
PRINCIPAL=130000000
INSTALLMENTS=4
# Live chains cannot be time-warped, so installments must fall due during the
# demo. Production intent is fortnightly; 90s compresses four installments into
# ~6 minutes of screen time. Narrate the compression.
DUE_EVERY=${DUE_EVERY:-90}
LIQUIDITY=${LIQUIDITY:-5000000000}   # 5,000 KUSDC seeded into the pool
APASS_EXPIRY=$(( $(date +%s) + 365*24*3600 ))

read -r -s -p "keystore password: " PW; echo
S="--rpc-url $RPC --password $PW"

# Anchor on the transactionHash line. A naive /0x[0-9a-f]{64}/ scan picks up
# logsBloom instead, which is ALL ZEROS on a reverted tx — that is what produced
# the 0x000...0 "hash" in the failed-origination step.
hash_of() { printf '%s\n' "$1" | awk '/^transactionHash/ {print $2; exit}'; }
step() { echo; echo "=== $* ==="; }

step "0. Merchant onboarding: register + activate in MerchantRegistry"
# Credentialing and registration are TWO separate onboarding steps. An A-Pass
# lets the merchant hold the settlement asset; MerchantRegistry is what lets the
# pool pay them. Having one without the other fails at origination with
# MerchantNotActive. register()/setActive() are onlyOwner.
#
# NOTE: MerchantRegistry stores payout/active/registered only — there is no name
# field on-chain. "Manila Coffee Roasters" is a display label held off-chain.
REGISTERED=$(cast call $REGISTRY 'isRegistered(address)(bool)' $MERCHANT --rpc-url $RPC)
ACTIVE=$(cast call $REGISTRY 'isActive(address)(bool)' $MERCHANT --rpc-url $RPC)
if [ "$REGISTERED" = "true" ] && [ "$ACTIVE" = "true" ]; then
  echo "  already registered and active — skipping (idempotent)"
elif [ "$REGISTERED" = "true" ]; then
  R=$(cast send $REGISTRY "setActive(address,bool)" $MERCHANT true --account kudira-deployer $S)
  echo "  setActive    $(hash_of "$R")"
else
  R=$(cast send $REGISTRY "register(address,address)" $MERCHANT $MERCHANT_PAYOUT --account kudira-deployer $S)
  echo "  register     $(hash_of "$R")   (Manila Coffee Roasters)"
fi
echo "  isRegistered $(cast call $REGISTRY 'isRegistered(address)(bool)' $MERCHANT --rpc-url $RPC)"
echo "  isActive     $(cast call $REGISTRY 'isActive(address)(bool)' $MERCHANT --rpc-url $RPC)"
echo "  payoutOf     $(cast call $REGISTRY 'payoutOf(address)(address)' $MERCHANT --rpc-url $RPC)"

step "1. Fund the pool with $LIQUIDITY KUSDC from the treasury"
POOL_BAL=$(cast call $KUSDC 'balanceOf(address)(uint256)' $POOL --rpc-url $RPC | awk '{print $1}')
if [ "$POOL_BAL" -ge "$LIQUIDITY" ]; then
  echo "  pool already holds $POOL_BAL KUSDC (>= $LIQUIDITY) — skipping (idempotent)"
else
  R=$(cast send $KUSDC "approve(address,uint256)" $POOL $LIQUIDITY --account kudira-deployer $S)
  echo "  approve      $(hash_of "$R")"
  R=$(cast send $POOL "fund(uint256)" $LIQUIDITY --account kudira-deployer $S)
  echo "  fund         $(hash_of "$R")"
fi
echo "  pool balance $(cast call $KUSDC 'balanceOf(address)(uint256)' $POOL --rpc-url $RPC)"

step "1b. Give the borrower the KUSDC they will repay with"
# collect() pulls FROM the borrower. An approval over a zero balance still
# reverts, just later and less legibly — so fund the wallet before approving.
BORROWER_BAL=$(cast call $KUSDC 'balanceOf(address)(uint256)' $BORROWER --rpc-url $RPC | awk '{print $1}')
if [ "$BORROWER_BAL" -ge "$PRINCIPAL" ]; then
  echo "  borrower already holds $BORROWER_BAL KUSDC — skipping (idempotent)"
else
  R=$(cast send $KUSDC "transfer(address,uint256)" $BORROWER $PRINCIPAL --account kudira-deployer $S)
  echo "  transfer     $(hash_of "$R")   ($PRINCIPAL KUSDC treasury -> borrower)"
fi
echo "  borrower bal $(cast call $KUSDC 'balanceOf(address)(uint256)' $BORROWER --rpc-url $RPC)"

step "2. NEGATIVE TEST: borrower is below the delinquency floor, origination must revert"
echo "  borrower subTier is 5; CreditLine.DELINQUENT_THRESHOLD is 10"
# --gas-limit skips estimation so the revert lands ON-CHAIN with a real tx hash,
# instead of cast refusing to broadcast it.
# --gas-limit skips estimation so the revert lands ON-CHAIN as a real tx.
# --async prints ONLY the hash and exits, so the hash cannot be lost in receipt
# parsing; the receipt is fetched separately below.
set +e
FAILED_TX=$(cast send $POOL \
  "originate(address,address,uint256,uint16,uint64,uint8,uint8,uint64)" \
  $BORROWER $MERCHANT $PRINCIPAL $INSTALLMENTS $DUE_EVERY 50 5 $APASS_EXPIRY \
  --account kudira-operator --gas-limit 900000 --async $S 2>&1 | tr -d '[:space:]')
set -e
echo "  failed tx    $FAILED_TX"
if [ -n "${FAILED_TX##*0x*}" ] || [ ${#FAILED_TX} -ne 66 ]; then
  echo "  !! could not capture a tx hash; raw output above"
else
  echo "  waiting for the receipt..."
  sleep 6
  RCPT=$(cast receipt "$FAILED_TX" --rpc-url $RPC 2>&1)
  echo "  status       $(printf '%s\n' "$RCPT" | awk '/^status/ {$1=""; print}' | sed 's/^ //')"
  echo "  gasUsed      $(printf '%s\n' "$RCPT" | awk '/^gasUsed/ {print $2}')"
  echo "  revert       $(cast run "$FAILED_TX" --rpc-url $RPC 2>&1 | grep -oE 'BorrowerDelinquent\([^)]*\)' | head -1 || echo '(run cast run for detail)')"
fi
echo "  (expect status 0 (failed), reverted with BorrowerDelinquent)"

step "3. Re-issue the borrower's A-Pass at subTier 50 (Grade B+, 500.00 limit)"
node scripts/reissue-apass.js "$BORROWER" "$BORROWER_CUSTOMER_ID" 50

step "4. Originate: 130.00 KUSDC, 4 x 32.50, merchant paid in full up front"
MERCH_BEFORE=$(cast call $KUSDC 'balanceOf(address)(uint256)' $MERCHANT --rpc-url $RPC | awk '{print $1}')
R=$(cast send $POOL \
  "originate(address,address,uint256,uint16,uint64,uint8,uint8,uint64)" \
  $BORROWER $MERCHANT $PRINCIPAL $INSTALLMENTS $DUE_EVERY 50 50 $APASS_EXPIRY \
  --account kudira-operator $S)
echo "  originate    $(hash_of "$R")"
PLAN_ID=$(cast call $POOL 'plans()(address)' --rpc-url $RPC | xargs -I{} cast call {} 'planCount()(uint256)' --rpc-url $RPC | awk '{print $1}')
echo "  planId       $PLAN_ID"
MERCH_AFTER=$(cast call $KUSDC 'balanceOf(address)(uint256)' $MERCHANT --rpc-url $RPC | awk '{print $1}')
echo "  merchant paid $(( MERCH_AFTER - MERCH_BEFORE )) (expect $PRINCIPAL, in the SAME tx)"

PLANS=$(cast call $POOL 'plans()(address)' --rpc-url $RPC)
CL=$(cast call $POOL 'creditLine()(address)' --rpc-url $RPC)
echo "  grade now    $(cast call $CL 'gradeOf(address)(uint8)' $BORROWER --rpc-url $RPC) ($(cast call $CL 'bandOf(address)(string)' $BORROWER --rpc-url $RPC))"
echo "  limit        $(cast call $CL 'limitOf(address)(uint256)' $BORROWER --rpc-url $RPC)"

step "5. Borrower approves the pool once, at signing"
R=$(cast send $KUSDC "approve(address,uint256)" $POOL $PRINCIPAL --account kudira-borrower $S)
echo "  approve      $(hash_of "$R")"

step "6. Auto-debit each installment as it falls due"
for i in 1 2 3 4; do
  DUE=$(cast call $PLANS 'dueDateOf(uint256,uint16)(uint64)' $PLAN_ID $i --rpc-url $RPC | awk '{print $1}')
  NOW=$(date +%s)
  if [ "$NOW" -lt "$DUE" ]; then
    echo "  waiting $(( DUE - NOW ))s for installment $i to fall due..."
    sleep $(( DUE - NOW + 3 ))
  fi
  R=$(cast send $POOL "collect(uint256)" $PLAN_ID --account kudira-operator $S)
  G=$(cast call $CL 'gradeOf(address)(uint8)' $BORROWER --rpc-url $RPC)
  echo "  collect #$i   $(hash_of "$R")   grade now $G  ($(cast call $CL 'bandOf(address)(string)' $BORROWER --rpc-url $RPC))"
done

step "7. Final state, read straight off the chain"
echo
echo "  --- these are live cast calls against Base Sepolia, nothing cached ---"
echo
echo "  \$ cast call \$CREDIT_LINE 'gradeBand(address)(string)' \$BORROWER"
echo "    -> $(cast call $CL 'bandOf(address)(string)' $BORROWER --rpc-url $RPC)"
echo
echo "  \$ cast call \$CREDIT_LINE 'gradeOf(address)(uint8)' \$BORROWER"
echo "    -> $(cast call $CL 'gradeOf(address)(uint8)' $BORROWER --rpc-url $RPC)"
echo
echo "  \$ cast call \$CREDIT_LINE 'limitOf(address)(uint256)' \$BORROWER"
echo "    -> $(cast call $CL 'limitOf(address)(uint256)' $BORROWER --rpc-url $RPC)  (6 decimals)"
echo
echo "  \$ cast call \$KUSDC 'balanceOf(address)(uint256)' \$POOL"
echo "    -> $(cast call $KUSDC 'balanceOf(address)(uint256)' $POOL --rpc-url $RPC)  (6 decimals)"
echo
echo "  --- supporting state ---"
echo "  plan status    $(cast call $PLANS 'statusOf(uint256)(uint8)' $PLAN_ID --rpc-url $RPC)  (2 = Completed)"
echo "  wasEverLate    $(cast call $PLANS 'wasEverLate(uint256)(bool)' $PLAN_ID --rpc-url $RPC)  <- false proves no installment slipped"
echo "  outstanding    $(cast call $CL 'outstandingOf(address)(uint256)' $BORROWER --rpc-url $RPC)"
echo "  completedPlans $(cast call $CL 'completedPlansOf(address)(uint32)' $BORROWER --rpc-url $RPC)"
# Merchant received THIS plan's principal exactly once; the raw balance is
# cumulative across every deployment's runs and reads as a double payment.
echo "  merchant received (this plan)  $(( $(cast call $KUSDC 'balanceOf(address)(uint256)' $MERCHANT --rpc-url $RPC | awk '{print $1}') - MERCH_BEFORE ))"
echo "  merchant balance (cumulative, all runs) $(cast call $KUSDC 'balanceOf(address)(uint256)' $MERCHANT --rpc-url $RPC | awk '{print $1}')"
echo
echo "  EXPECTED: grade 70, band \"A-\", limit 700000000, plan status 2"
echo
echo "Done. Every hash above is on Base Sepolia (chainId 84532)."
