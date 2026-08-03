// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {CreditLine} from "./CreditLine.sol";
import {InstallmentPlan} from "./InstallmentPlan.sol";
import {MerchantRegistry} from "./MerchantRegistry.sol";
import {TierRules} from "./TierRules.sol";

/// @title KudiraPool
/// @notice The registered Cleanverse compliance pool. Holds aUSDC liquidity,
///         originates installment plans, pays merchants in full up front and
///         receives repayments.
///
/// @dev **`Ownable` is load-bearing and not retrofittable.** Cleanverse
///      `validator/grant` and `validator/register` verify an EIP-191
///      `personal_sign` over `lowercase(chain) + lowercase(address)` against this
///      contract's on-chain `owner()`. A pool without `owner()` cannot be
///      registered and would need a full redeploy (ARCHITECTURE.md §3.3).
///
///      All money paths are aUSDC, 6 decimals.
contract KudiraPool is Ownable {
    using SafeERC20 for IERC20;
    using TierRules for uint8;

    /// @notice aUSDC. 6 decimals — never assume 18.
    IERC20 public immutable asset;
    MerchantRegistry public immutable merchants;
    CreditLine public immutable creditLine;
    InstallmentPlan public immutable plans;

    /// @notice Local mirror of the pool's Cleanverse validator rule.
    /// @dev Compared with strictly-greater semantics; `0` means unrestricted.
    ///      Kept in sync with `validator/set_rule` so on-chain underwriting can
    ///      never approve someone the off-chain validator would reject.
    uint8 public minTier;
    uint8 public minSubTier;

    /// @notice Day-to-day underwriting key: may originate plans and record
    ///         defaults, nothing else.
    /// @dev Split from `owner` deliberately. `owner()` is the identity the
    ///      Cleanverse validator signature is checked against and the key that
    ///      moves liquidity, so it should be cold. Origination has to be online
    ///      to relay attested A-Pass reads, so it gets its own hot key that
    ///      cannot withdraw funds or change policy.
    address public operator;

    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event RuleUpdated(uint8 minTier, uint8 minSubTier);
    event Funded(address indexed from, uint256 amount, uint256 liquidity);
    event Withdrawn(address indexed to, uint256 amount, uint256 liquidity);
    event PlanOriginated(
        uint256 indexed planId,
        address indexed borrower,
        address indexed merchant,
        uint256 principal,
        uint16 installments,
        uint64 dueEvery,
        uint8 apassTier,
        uint8 apassSubTier,
        uint64 apassExpirationTime
    );
    event MerchantPaid(
        uint256 indexed planId, address indexed merchant, address indexed payout, uint256 amount
    );
    event RepaymentReceived(
        uint256 indexed planId, address indexed payer, uint256 amount, uint256 outstanding
    );
    event AutoDebited(
        uint256 indexed planId, address indexed borrower, address indexed triggeredBy, uint256 amount
    );
    event PlanSettled(uint256 indexed planId, address indexed borrower, bool onTime);
    event PlanDefaulted(uint256 indexed planId, address indexed borrower, uint256 writtenOff);

    error ZeroAddress();
    error ZeroAmount();
    error MerchantNotActive(address merchant);
    /// @dev The borrower's credential fails the pool's validator rule.
    error ApassRuleNotSatisfied(uint8 tier, uint8 subTier, uint8 minTier, uint8 minSubTier);
    error BorrowerDelinquent(address borrower, uint8 grade);
    error ExceedsCreditLimit(uint256 principal, uint256 available);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error PlanNotLate(uint256 planId);
    error NotOperator(address caller);
    /// @dev Auto-debit may only be triggered by the operator or the borrower.
    error NotCollector(address caller, address borrower);
    error NothingDueYet(uint256 planId, uint64 nextDueDate);
    error InsufficientAllowance(address borrower, uint256 allowance, uint256 required);

    /// @dev Origination and default marking only. Never liquidity or policy.
    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        _;
    }

    /// @param initialOwner Governance owner — the identity the Cleanverse
    ///        validator signature is checked against. Pass `address(0)` to use
    ///        the deployer, which lets a deploy script call `setOperator` in the
    ///        same batch before handing ownership to a cold wallet or multisig.
    constructor(address asset_, address merchants_, address creditLine_, address plans_, address initialOwner)
        Ownable(initialOwner == address(0) ? msg.sender : initialOwner)
    {
        if (
            asset_ == address(0) || merchants_ == address(0) || creditLine_ == address(0)
                || plans_ == address(0)
        ) revert ZeroAddress();

        asset = IERC20(asset_);
        merchants = MerchantRegistry(merchants_);
        creditLine = CreditLine(creditLine_);
        plans = InstallmentPlan(plans_);
    }

    // --- Liquidity ------------------------------------------------------------

    function fund(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount, liquidity());
    }

    function withdraw(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = liquidity();
        if (amount > available) revert InsufficientLiquidity(amount, available);

        asset.safeTransfer(to, amount);
        emit Withdrawn(to, amount, liquidity());
    }

    function liquidity() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    // --- Policy ---------------------------------------------------------------

    /// @notice Set the underwriting key. Governance action, owner only.
    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        address old = operator;
        operator = newOperator;
        emit OperatorUpdated(old, newOperator);
    }

    /// @notice Mirror of `validator/set_rule`, which replaces all rules with one.
    function setRule(uint8 minTier_, uint8 minSubTier_) external onlyOwner {
        minTier = minTier_;
        minSubTier = minSubTier_;
        emit RuleUpdated(minTier_, minSubTier_);
    }

    /// @notice Does this credential satisfy the pool's rule?
    /// @dev Strictly greater than, mirroring Cleanverse. Equal to the minimum fails.
    function satisfiesRule(uint8 apassTier, uint8 apassSubTier) public view returns (bool) {
        return apassTier.satisfies(minTier) && apassSubTier.satisfies(minSubTier);
    }

    // --- Origination ----------------------------------------------------------

    /// @notice Underwrite a purchase and pay the merchant in full.
    /// @dev Operator-only: the A-Pass fields are attested by the Kudira backend,
    ///      which reads them from `query_apass` and is trusted to relay them.
    ///      The operator key can commit liquidity to a plan but cannot withdraw
    ///      it or change policy — those stay with `owner()`.
    /// @param apassExpirationTime A-Pass expiry, Unix seconds. The schedule must
    ///        end strictly before this or the plan reverts.
    function originate(
        address borrower,
        address merchant,
        uint256 principal,
        uint16 installments,
        uint64 dueEvery,
        uint8 apassTier,
        uint8 apassSubTier,
        uint64 apassExpirationTime
    ) external onlyOperator returns (uint256 planId) {
        if (borrower == address(0)) revert ZeroAddress();
        if (principal == 0) revert ZeroAmount();
        if (!merchants.isActive(merchant)) revert MerchantNotActive(merchant);

        // 1. Validator rule, strictly-greater. Never approve someone Cleanverse would reject.
        if (!satisfiesRule(apassTier, apassSubTier)) {
            revert ApassRuleNotSatisfied(apassTier, apassSubTier, minTier, minSubTier);
        }

        // 2. Seed the account from the credential on first sight; existing
        //    on-chain history wins over a possibly stale off-chain read.
        uint8 grade = creditLine.ensureAccount(borrower, apassSubTier);
        if (grade < creditLine.DELINQUENT_THRESHOLD()) revert BorrowerDelinquent(borrower, grade);

        // 3. Credit limit.
        uint256 available = creditLine.availableCredit(borrower);
        if (principal > available) revert ExceedsCreditLimit(principal, available);

        // 4. Liquidity must cover the merchant payout.
        uint256 cash = liquidity();
        if (principal > cash) revert InsufficientLiquidity(principal, cash);

        // 5. Schedule. Reverts if the terms outlive the A-Pass credential.
        planId = plans.create(borrower, merchant, principal, installments, dueEvery, apassExpirationTime);
        creditLine.recordOrigination(borrower, principal);

        emit PlanOriginated(
            planId,
            borrower,
            merchant,
            principal,
            installments,
            dueEvery,
            apassTier,
            apassSubTier,
            apassExpirationTime
        );

        // 6. Merchant is paid in full, immediately.
        address payout = merchants.payoutOf(merchant);
        asset.safeTransfer(payout, principal);
        emit MerchantPaid(planId, merchant, payout, principal);
    }

    // --- Repayment ------------------------------------------------------------

    /// @notice Repay against a plan. Anyone may pay, but funds come from the caller.
    function repay(uint256 planId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        InstallmentPlan.Plan memory p = plans.getPlan(planId);
        _settle(planId, p.borrower, msg.sender, amount);
    }

    /// @notice Auto-debit: pull the amount currently due from the borrower's
    ///         aUSDC allowance.
    /// @dev The borrower approves the pool once at signing; collection then
    ///      needs no further action from them. Callable by the operator (the
    ///      scheduled collections job) or by the borrower themselves, which
    ///      doubles as the manual trigger for the demo.
    ///
    ///      Every failure mode reverts with a named error rather than silently
    ///      collecting the wrong amount:
    ///        - nothing due yet, or paid ahead      -> NothingDueYet
    ///        - plan already settled or defaulted   -> PlanNotActive (from plans)
    ///        - allowance too small                 -> InsufficientAllowance
    ///        - either party lost its A-Pass        -> reverts inside aUSDC
    /// @return amount The amount actually collected.
    function collect(uint256 planId) external returns (uint256 amount) {
        InstallmentPlan.Plan memory p = plans.getPlan(planId);
        if (msg.sender != operator && msg.sender != p.borrower) {
            revert NotCollector(msg.sender, p.borrower);
        }

        amount = plans.amountDueNow(planId);
        if (amount == 0) revert NothingDueYet(planId, plans.nextDueDate(planId));

        // Check the allowance explicitly so a short approval reports itself
        // rather than surfacing as an opaque transfer failure.
        uint256 allowed = asset.allowance(p.borrower, address(this));
        if (allowed < amount) revert InsufficientAllowance(p.borrower, allowed, amount);

        _settle(planId, p.borrower, p.borrower, amount);
        emit AutoDebited(planId, p.borrower, msg.sender, amount);
    }

    /// @dev Shared settlement path for `repay` and `collect`.
    function _settle(uint256 planId, address borrower, address payer, uint256 amount) private {
        asset.safeTransferFrom(payer, address(this), amount);

        (bool completed, uint16 newlyCovered, bool late) = plans.recordPayment(planId, amount);
        creditLine.recordRepayment(borrower, amount);

        // Grade is earned per installment settled on schedule, not in a lump at
        // completion. A payment made while overdue earns nothing.
        if (!late && newlyCovered > 0) {
            creditLine.recordOnTimeInstallments(borrower, newlyCovered);
        }

        emit RepaymentReceived(planId, payer, amount, plans.outstandingOf(planId));

        if (completed) {
            bool onTime = !plans.wasEverLate(planId);
            creditLine.recordCompletion(borrower, onTime);
            emit PlanSettled(planId, borrower, onTime);
        }
    }

    /// @notice Write off a late plan and downgrade the borrower.
    /// @dev Downgrade only — never an A-Pass freeze (ARCHITECTURE.md §3.2).
    ///      Operator-only: routine collections work, not governance.
    function markDefault(uint256 planId) external onlyOperator {
        if (!plans.isLate(planId)) revert PlanNotLate(planId);

        InstallmentPlan.Plan memory p = plans.getPlan(planId);
        uint256 remaining = plans.markDefault(planId);
        creditLine.recordDefault(p.borrower, remaining);

        emit PlanDefaulted(planId, p.borrower, remaining);
    }
}
