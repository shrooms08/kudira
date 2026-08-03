#!/usr/bin/env bash
# ONE origination and nothing else.
#
# Deliberately separate from live-origination.sh. That script is proven on
# camera and gains nothing from branches; this one exists so plan 2 can be
# created without touching it.
#
# Every step checks its precondition before acting, so re-running is safe:
#   1. borrower A-Pass at the required subTier   (re-issue only if it differs)
#   2. borrower holds enough KUSDC to repay      (transfer only if short)
#   3. originate                                  (refuse if an identical live
#                                                  plan already exists)
#
# It does NOT approve, collect, or run a negative test. The buyer signs their own
# approve in the checkout UI, which is the whole point of that step.
#
#   BORROWER=0x... BORROWER_CUSTOMER_ID=KUDIRA... ./scripts/originate-plan.sh

set -euo pipefail
cd "$(dirname "$0")/.."

RPC=${RPC:-https://sepolia.base.org}
POOL=0x4a898781AFAd85BE7103126952BcBbFCCC24199e
KUSDC=0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E
PLANS=0xb4c055e7e880A684F9276435BDc12d25577d39D8
CREDIT=0x49cD6c00EC00116Eed598b8e07f1B0D7A4805cBE
REGISTRY=0x05e2A2473e710435484f6B3b288677618E95bB15
MERCHANT=0xE8D7b7CEDC7b114D56E7828C7179c6a9b9EEe06D   # Manila Coffee Roasters
TREASURY=0x021Fed3a7d7367B3d4Da7812B38355014AFc808F

BORROWER=${BORROWER:?set BORROWER=0x...}
BORROWER_CUSTOMER_ID=${BORROWER_CUSTOMER_ID:?set BORROWER_CUSTOMER_ID=KUDIRA...}

# Plan 2 economics: 260.00 KUSDC over 4 x 65.00, one week apart.
PRINCIPAL=${PRINCIPAL:-260000000}
INSTALLMENTS=${INSTALLMENTS:-4}
DUE_EVERY=${DUE_EVERY:-604800}          # 7 days
SUB_TIER=${SUB_TIER:-50}                # Grade B+, 500.00 limit
APASS_TIER=${APASS_TIER:-50}
APASS_EXPIRY=$(( $(date +%s) + 365*24*3600 ))

read -r -s -p "keystore password: " PW; echo
S="--rpc-url $RPC --password $PW"

# Anchor on the transactionHash line. A bare /0x[0-9a-f]{64}/ scan picks up
# logsBloom, which is all zeros on a reverted tx.
hash_of() { printf '%s\n' "$1" | awk '/^transactionHash/ {print $2; exit}'; }
step()    { echo; echo "=== $* ==="; }
call()    { cast call "$@" --rpc-url $RPC 2>/dev/null | awk '{print $1}'; }

echo
echo "Plan 2: $PRINCIPAL KUSDC over $INSTALLMENTS installments, every $DUE_EVERY seconds"
echo "  borrower  $BORROWER"
echo "  merchant  $MERCHANT"
echo "  pool      $POOL"

# --- 0. Sanity: the things that must already be true ---------------------------
step "0. Preconditions"
ACTIVE=$(call $REGISTRY 'isActive(address)(bool)' $MERCHANT)
echo "  merchant registered + active .. $ACTIVE"
[ "$ACTIVE" = "true" ] || { echo "  ABORT: merchant is not active in the registry"; exit 1; }

LIQ=$(call $KUSDC 'balanceOf(address)(uint256)' $POOL)
echo "  pool liquidity ................ $LIQ"
[ "$LIQ" -ge "$PRINCIPAL" ] || { echo "  ABORT: pool holds less than the principal"; exit 1; }

TREAS=$(call $KUSDC 'balanceOf(address)(uint256)' $TREASURY)
echo "  treasury balance .............. $TREAS"

# --- 1. Borrower A-Pass at the required subTier --------------------------------
step "1. Borrower A-Pass subTier $SUB_TIER"
CURRENT=$(node -e '
import("./src/lib/tls-compat.js").then(async () => {
  const { loadEnv } = await import("./load-env.js");
  loadEnv(new URL("./.env", "file://" + process.cwd() + "/"));
  const r = await fetch("https://uatapi.cleanverse.com/api/cooperate/query_apass", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-id": process.env.CLEANVERSE_API_ID },
    body: JSON.stringify({ chain: "base", address: process.argv[1] }),
  });
  const j = await r.json();
  process.stdout.write(String(j?.data?.subTier ?? "none"));
});' "$BORROWER")
echo "  current subTier ............... $CURRENT"
if [ "$CURRENT" = "$SUB_TIER" ]; then
  echo "  already at $SUB_TIER, skipping (idempotent)"
else
  node scripts/reissue-apass.js "$BORROWER" "$BORROWER_CUSTOMER_ID" "$SUB_TIER"
fi

# --- 2. Borrower holds enough KUSDC to repay with ------------------------------
# The plan is originated regardless, but a borrower with a zero balance makes the
# approve meaningless and every later collect reverts. Fund first.
step "2. Borrower funded to repay $PRINCIPAL"
BAL=$(call $KUSDC 'balanceOf(address)(uint256)' $BORROWER)
echo "  borrower balance .............. $BAL"
if [ "$BAL" -ge "$PRINCIPAL" ]; then
  echo "  already funded, skipping (idempotent)"
else
  SHORT=$(( PRINCIPAL - BAL ))
  echo "  short by $SHORT, transferring from treasury"
  [ "$TREAS" -ge "$SHORT" ] || { echo "  ABORT: treasury cannot cover the shortfall"; exit 1; }
  R=$(cast send $KUSDC "transfer(address,uint256)" $BORROWER $SHORT --account kudira-deployer $S)
  echo "  transfer  $(hash_of "$R")"
  echo "  borrower balance now .......... $(call $KUSDC 'balanceOf(address)(uint256)' $BORROWER)"
fi

# --- 3. Originate ---------------------------------------------------------------
step "3. Originate"
BEFORE=$(call $PLANS 'planCount()(uint256)')
echo "  planCount before .............. $BEFORE"

# Refuse to stack a duplicate: if the borrower already has an ACTIVE plan of this
# size, a second run was almost certainly a mistake.
EXISTING_OUTSTANDING=$(call $CREDIT 'outstandingOf(address)(uint256)' $BORROWER)
if [ "$EXISTING_OUTSTANDING" -ge "$PRINCIPAL" ]; then
  echo "  borrower already owes $EXISTING_OUTSTANDING, which covers this principal."
  echo "  Refusing to originate a duplicate. Set FORCE=1 to override."
  [ "${FORCE:-0}" = "1" ] || exit 0
fi

MERCH_BEFORE=$(call $KUSDC 'balanceOf(address)(uint256)' $MERCHANT)
R=$(cast send $POOL \
  "originate(address,address,uint256,uint16,uint64,uint8,uint8,uint64)" \
  $BORROWER $MERCHANT $PRINCIPAL $INSTALLMENTS $DUE_EVERY $APASS_TIER $SUB_TIER $APASS_EXPIRY \
  --account kudira-operator $S)
echo "  originate $(hash_of "$R")"

PLAN_ID=$(call $PLANS 'planCount()(uint256)')
MERCH_AFTER=$(call $KUSDC 'balanceOf(address)(uint256)' $MERCHANT)

step "4. Result, read from the chain"
echo "  planId ........................ $PLAN_ID"
echo "  merchant received (this plan) .. $(( MERCH_AFTER - MERCH_BEFORE ))  (expect $PRINCIPAL)"
echo "  installment amount ............ $(call $PLANS 'installmentAmount(uint256)(uint256)' $PLAN_ID)"
echo "  grace period .................. $(call $PLANS 'gracePeriodOf(uint256)(uint64)' $PLAN_ID)s"
echo "  next due date ................. $(call $PLANS 'nextDueDate(uint256)(uint64)' $PLAN_ID)"
echo "  borrower grade ................ $(call $CREDIT 'gradeOf(address)(uint8)' $BORROWER)"
echo "  borrower band ................. $(cast call $CREDIT 'bandOf(address)(string)' $BORROWER --rpc-url $RPC)"
echo "  limit ......................... $(call $CREDIT 'limitOf(address)(uint256)' $BORROWER)"
echo "  outstanding ................... $(call $CREDIT 'outstandingOf(address)(uint256)' $BORROWER)"
echo "  available credit .............. $(call $CREDIT 'availableCredit(address)(uint256)' $BORROWER)"
echo
echo "The account page should now show a live next payment. Nothing was approved"
echo "or collected: the buyer signs their own approve in the checkout UI."
