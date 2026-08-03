// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title InstallmentPlan
/// @notice Repayment schedules: due dates, late detection and completion.
/// @dev HARD RULE (ARCHITECTURE.md §4): a plan's final due date must fall
///      strictly before the borrower's A-Pass `expirationTime`. Credit is only
///      safe while the credential backing it is live, so the schedule may never
///      outlive the credential. The expiry is supplied at origination and the
///      creation reverts if violated.
contract InstallmentPlan is Ownable {
    enum Status {
        None,
        Active,
        Completed,
        Defaulted
    }

    struct Plan {
        address borrower;
        address merchant;
        uint256 principal;
        uint256 amountPaid;
        uint16 installments;
        uint64 startTime;
        uint64 dueEvery;
        /// @dev A-Pass expirationTime, Unix seconds.
        uint64 apassExpirationTime;
        /// @dev How long after a due date a payment still counts as on time.
        ///      Stored PER PLAN, fixed at origination. A later policy change must
        ///      never retroactively rewrite the terms of a live loan: the grace a
        ///      borrower was granted when they signed is the grace they keep. That
        ///      is a compliance answer as much as a design one — the terms a
        ///      borrower agreed to must be reconstructible from the chain.
        uint64 gracePeriod;
        /// @dev True once any payment was made after its due date, or a default
        ///      was recorded. Latches — a late plan can never become on-time.
        bool everLate;
        Status status;
    }

    /// @notice Grace is one tenth of the payment period, never below a minute.
    /// @dev Proportional rather than absolute so it scales with the schedule.
    ///      Fortnightly instalments get ~1.4 days, which matches the everyday
    ///      convention that a payment is on time any time on its due date. An
    ///      absolute default (say one day) would exceed a short period entirely,
    ///      making "late" unreachable and silently disabling the default path.
    ///      The floor stops a pathologically short period yielding zero grace.
    uint64 public constant GRACE_DIVISOR = 10;
    uint64 public constant MIN_GRACE = 60;

    /// @notice The KudiraPool permitted to mutate plan state.
    address public pool;

    uint256 public planCount;
    mapping(uint256 planId => Plan) private _plans;

    event PoolUpdated(address indexed oldPool, address indexed newPool);
    event PlanCreated(
        uint256 indexed planId,
        address indexed borrower,
        address indexed merchant,
        uint256 principal,
        uint16 installments,
        uint64 dueEvery,
        uint64 finalDueDate,
        uint64 apassExpirationTime,
        uint64 gracePeriod
    );
    event PaymentRecorded(
        uint256 indexed planId, uint256 amount, uint256 amountPaid, uint16 installmentsCovered, bool late
    );
    event PlanCompleted(uint256 indexed planId, bool onTime);
    event PlanDefaulted(uint256 indexed planId, uint256 remaining);

    error NotPool(address caller);
    error ZeroAddress();
    error UnknownPlan(uint256 planId);
    error PlanNotActive(uint256 planId, Status status);
    error InvalidTerms();
    /// @dev The schedule would outlive the credential backing it.
    error TermsExceedApassExpiry(uint64 finalDueDate, uint64 apassExpirationTime);
    error PaymentExceedsOutstanding(uint256 amount, uint256 outstanding);

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool(msg.sender);
        _;
    }

    /// @param initialOwner Owner of this contract. Pass `address(0)` to use the
    ///        deployer, which lets a deploy script call `setPool` in the same
    ///        batch before handing ownership to a cold wallet or multisig.
    constructor(address initialOwner) Ownable(initialOwner == address(0) ? msg.sender : initialOwner) {}

    /// @notice Grace that a plan on this cadence would be created with.
    /// @dev Pure, so a frontend can show the same number the chain will apply.
    function graceFor(uint64 dueEvery) public pure returns (uint64) {
        uint64 proportional = dueEvery / GRACE_DIVISOR;
        return proportional < MIN_GRACE ? MIN_GRACE : proportional;
    }

    function setPool(address newPool) external onlyOwner {
        if (newPool == address(0)) revert ZeroAddress();
        address old = pool;
        pool = newPool;
        emit PoolUpdated(old, newPool);
    }

    /// @notice Create a schedule. Reverts if it would extend to or past A-Pass expiry.
    function create(
        address borrower,
        address merchant,
        uint256 principal,
        uint16 installments,
        uint64 dueEvery,
        uint64 apassExpirationTime
    ) external onlyPool returns (uint256 planId) {
        if (borrower == address(0) || merchant == address(0)) revert ZeroAddress();
        if (principal == 0 || installments == 0 || dueEvery == 0) revert InvalidTerms();

        uint64 startTime = uint64(block.timestamp);
        uint64 finalDue = startTime + (dueEvery * uint64(installments));

        // Strictly before: a plan whose last payment lands exactly on expiry is
        // already too late — the credential is gone the moment it matures.
        if (finalDue >= apassExpirationTime) {
            revert TermsExceedApassExpiry(finalDue, apassExpirationTime);
        }

        uint64 grace = graceFor(dueEvery);

        planId = ++planCount;
        _plans[planId] = Plan({
            borrower: borrower,
            merchant: merchant,
            principal: principal,
            amountPaid: 0,
            installments: installments,
            startTime: startTime,
            dueEvery: dueEvery,
            apassExpirationTime: apassExpirationTime,
            gracePeriod: grace,
            everLate: false,
            status: Status.Active
        });

        emit PlanCreated(
            planId,
            borrower,
            merchant,
            principal,
            installments,
            dueEvery,
            finalDue,
            apassExpirationTime,
            grace
        );
    }

    /// @notice Apply a repayment. Lateness is judged before the payment lands.
    /// @return completed True when this payment closed out the plan.
    /// @return newlyCovered Installments this payment brought fully current.
    ///         The pool credits grade per installment, so it needs the delta and
    ///         not just the running total.
    /// @return late Whether the plan was overdue at the moment of payment.
    function recordPayment(uint256 planId, uint256 amount)
        external
        onlyPool
        returns (bool completed, uint16 newlyCovered, bool late)
    {
        Plan storage p = _requireActive(planId);

        uint256 outstanding = p.principal - p.amountPaid;
        if (amount == 0 || amount > outstanding) revert PaymentExceedsOutstanding(amount, outstanding);

        uint16 coveredBefore = _installmentsCovered(p);
        late = _isLate(p);
        if (late) p.everLate = true;

        p.amountPaid += amount;
        uint16 covered = _installmentsCovered(p);
        newlyCovered = covered - coveredBefore;

        emit PaymentRecorded(planId, amount, p.amountPaid, covered, late);

        if (p.amountPaid == p.principal) {
            p.status = Status.Completed;
            completed = true;
            emit PlanCompleted(planId, !p.everLate);
        }
    }

    /// @notice Close a plan as defaulted.
    /// @return remaining The unpaid principal written off.
    function markDefault(uint256 planId) external onlyPool returns (uint256 remaining) {
        Plan storage p = _requireActive(planId);

        remaining = p.principal - p.amountPaid;
        p.everLate = true;
        p.status = Status.Defaulted;

        emit PlanDefaulted(planId, remaining);
    }

    // --- Views ----------------------------------------------------------------

    function getPlan(uint256 planId) external view returns (Plan memory) {
        if (_plans[planId].status == Status.None) revert UnknownPlan(planId);
        return _plans[planId];
    }

    function statusOf(uint256 planId) external view returns (Status) {
        return _plans[planId].status;
    }

    /// @notice Base amount per installment. Any rounding dust rides on the final one.
    function installmentAmount(uint256 planId) external view returns (uint256) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        return p.principal / p.installments;
    }

    function outstandingOf(uint256 planId) external view returns (uint256) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        return p.principal - p.amountPaid;
    }

    function finalDueDate(uint256 planId) public view returns (uint64) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        return p.startTime + (p.dueEvery * uint64(p.installments));
    }

    /// @notice Due date of installment `index` (1-based).
    function dueDateOf(uint256 planId, uint16 index) public view returns (uint64) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        if (index == 0 || index > p.installments) revert InvalidTerms();
        return p.startTime + (p.dueEvery * uint64(index));
    }

    /// @notice Due date of the next unpaid installment. Zero once fully covered.
    function nextDueDate(uint256 planId) external view returns (uint64) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        uint16 covered = _installmentsCovered(p);
        if (covered >= p.installments) return 0;
        return p.startTime + (p.dueEvery * uint64(covered + 1));
    }

    /// @notice True when the next unpaid installment is past its due date.
    function isLate(uint256 planId) external view returns (bool) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        return _isLate(p);
    }

    /// @notice The grace this plan was created with. Immutable for its lifetime.
    function gracePeriodOf(uint256 planId) external view returns (uint64) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        return p.gracePeriod;
    }

    function wasEverLate(uint256 planId) external view returns (bool) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        return p.everLate;
    }

    /// @notice How many installments have reached their due date.
    /// @dev Time-based, unlike `installmentsCovered` which is payment-based.
    ///      The gap between the two is exactly what auto-debit collects.
    function installmentsElapsed(uint256 planId) public view returns (uint16) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        if (block.timestamp < p.startTime + p.dueEvery) return 0;
        uint256 elapsed = (block.timestamp - p.startTime) / p.dueEvery;
        return elapsed >= p.installments ? p.installments : uint16(elapsed);
    }

    /// @notice Amount needed to bring the plan current right now.
    /// @dev Zero when nothing is due yet or the borrower is paid ahead — the
    ///      caller decides whether that is an error. Never exceeds the
    ///      outstanding balance.
    function amountDueNow(uint256 planId) external view returns (uint256) {
        Plan storage p = _plans[planId];
        if (p.status != Status.Active) return 0;
        uint256 owed = _cumulativeDue(p, installmentsElapsed(planId));
        if (owed <= p.amountPaid) return 0;
        return owed - p.amountPaid;
    }

    function installmentsCovered(uint256 planId) external view returns (uint16) {
        Plan storage p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        return _installmentsCovered(p);
    }

    // --- Internals ------------------------------------------------------------

    function _requireActive(uint256 planId) private view returns (Plan storage p) {
        p = _plans[planId];
        if (p.status == Status.None) revert UnknownPlan(planId);
        if (p.status != Status.Active) revert PlanNotActive(planId, p.status);
    }

    /// @dev Cumulative amount due after `k` installments. The final installment
    ///      settles the whole principal, absorbing any rounding dust.
    function _cumulativeDue(Plan storage p, uint16 k) private view returns (uint256) {
        if (k == 0) return 0;
        if (k >= p.installments) return p.principal;
        return (p.principal / p.installments) * uint256(k);
    }

    /// @dev Number of installments fully covered by the amount paid so far.
    ///      Cumulative due after k installments is `base * k`, except the final
    ///      installment which settles the whole principal (absorbing rounding dust).
    function _installmentsCovered(Plan storage p) private view returns (uint16) {
        if (p.amountPaid >= p.principal) return p.installments;
        uint256 base = p.principal / p.installments;
        if (base == 0) return 0;
        uint256 covered = p.amountPaid / base;
        // Only the full principal can cover the last installment.
        if (covered >= p.installments) return p.installments - 1;
        // casting to 'uint16' is safe because the line above returns unless
        // covered < p.installments, and installments is itself a uint16.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(covered);
    }

    function _isLate(Plan storage p) private view returns (bool) {
        if (p.status != Status.Active) return false;
        uint16 covered = _installmentsCovered(p);
        if (covered >= p.installments) return false;
        uint64 due = p.startTime + (p.dueEvery * uint64(covered + 1));
        // Grace, not a bare `> due`. Auto-debit fires WHEN an instalment falls
        // due, so the transaction necessarily mines at or after that timestamp.
        // Without grace the only on-time instant is `== due`, which a live chain
        // cannot hit, and every collected payment is late by construction.
        return block.timestamp > due + p.gracePeriod;
    }
}
