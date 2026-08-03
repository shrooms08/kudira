// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CreditLine
/// @notice Per-borrower credit standing: grade, limit, outstanding balance and
///         repayment history.
/// @dev The `grade` is Kudira's own credit score and maps 1:1 onto the A-Pass
///      `subTier` (ARCHITECTURE.md §3.2). A-Pass `subTier` is an integer; do not
///      confuse it with `tier`, which the API returns as a string.
///
///      Ladder:
///        limit    = grade * 10 aUSDC, and zero while delinquent
///        on time  = +5 per installment paid on schedule
///        default  = -20
///      Both movements saturate: never above MAX_GRADE, never below zero.
///
///      Rewarding per installment rather than per completed plan means the
///      borrower's limit grows as they demonstrate reliability, not only at the
///      end of a plan. It also means a long plan paid faithfully counts for more
///      than a short one, which is the behaviour we actually want to price.
contract CreditLine is Ownable {
    struct Account {
        bool exists;
        uint8 grade;
        uint256 outstanding;
        uint32 completedPlans;
        uint32 defaults;
    }

    /// @notice Grades strictly below this are delinquent and blocked.
    uint8 public constant DELINQUENT_THRESHOLD = 10;
    uint8 public constant MAX_GRADE = 99;
    /// @notice Grade assigned to a borrower with no prior A-Pass standing.
    uint8 public constant STARTING_GRADE = 10;

    /// @notice Grade movement per outcome.
    uint8 public constant GRADE_STEP_UP = 5; // per on-time installment
    uint8 public constant GRADE_STEP_DOWN = 20; // per default

    /// @notice Credit limit per grade point, in aUSDC (6 decimals).
    /// @dev limit = grade * 10 aUSDC. Grade 10 -> 100, grade 99 -> 990.
    uint256 public constant LIMIT_PER_GRADE = 10e6;

    /// @notice The KudiraPool permitted to mutate credit state.
    address public pool;

    mapping(address borrower => Account) private _accounts;

    event PoolUpdated(address indexed oldPool, address indexed newPool);
    event AccountOpened(address indexed borrower, uint8 grade);
    event GradeSynced(address indexed borrower, uint8 oldGrade, uint8 newGrade);
    event OriginationRecorded(address indexed borrower, uint256 amount, uint256 outstanding);
    event RepaymentRecorded(address indexed borrower, uint256 amount, uint256 outstanding);
    event OnTimeInstallmentsRecorded(address indexed borrower, uint16 count, uint8 oldGrade, uint8 newGrade);
    event PlanCompletionRecorded(address indexed borrower, bool onTime, uint32 completedPlans);
    event DefaultRecorded(address indexed borrower, uint256 writtenOff, uint8 oldGrade, uint8 newGrade);

    error NotPool(address caller);
    error ZeroAddress();
    error UnknownAccount(address borrower);
    error AmountExceedsOutstanding(uint256 amount, uint256 outstanding);

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool(msg.sender);
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner == address(0) ? msg.sender : initialOwner) {}

    function setPool(address newPool) external onlyOwner {
        if (newPool == address(0)) revert ZeroAddress();
        address old = pool;
        pool = newPool;
        emit PoolUpdated(old, newPool);
    }

    /// @notice Open an account, seeding the grade from the borrower's A-Pass subTier.
    /// @dev Idempotent: an existing account is left untouched so on-chain history
    ///      is never clobbered by a stale off-chain read.
    function ensureAccount(address borrower, uint8 initialGrade) external onlyPool returns (uint8) {
        Account storage a = _accounts[borrower];
        if (!a.exists) {
            a.exists = true;
            a.grade = initialGrade == 0 ? STARTING_GRADE : initialGrade;
            emit AccountOpened(borrower, a.grade);
        }
        return a.grade;
    }

    /// @notice Deliberately re-seed a grade from the A-Pass credential.
    /// @dev Owner-only and never called during origination — the on-chain grade
    ///      is canonical between explicit syncs.
    function syncGrade(address borrower, uint8 newGrade) external onlyOwner {
        Account storage a = _accounts[borrower];
        if (!a.exists) revert UnknownAccount(borrower);
        uint8 old = a.grade;
        a.grade = newGrade;
        emit GradeSynced(borrower, old, newGrade);
    }

    function recordOrigination(address borrower, uint256 amount) external onlyPool {
        Account storage a = _accounts[borrower];
        if (!a.exists) revert UnknownAccount(borrower);
        a.outstanding += amount;
        emit OriginationRecorded(borrower, amount, a.outstanding);
    }

    function recordRepayment(address borrower, uint256 amount) external onlyPool {
        Account storage a = _accounts[borrower];
        if (!a.exists) revert UnknownAccount(borrower);
        if (amount > a.outstanding) revert AmountExceedsOutstanding(amount, a.outstanding);
        a.outstanding -= amount;
        emit RepaymentRecorded(borrower, amount, a.outstanding);
    }

    /// @notice Reward installments settled on schedule: +5 grade each.
    /// @dev Called for every payment that lands on time, not only at completion.
    function recordOnTimeInstallments(address borrower, uint16 count) external onlyPool {
        Account storage a = _accounts[borrower];
        if (!a.exists) revert UnknownAccount(borrower);
        if (count == 0) return;

        uint8 old = a.grade;
        uint256 raised = uint256(old) + (uint256(count) * GRADE_STEP_UP);
        a.grade = raised > MAX_GRADE ? MAX_GRADE : uint8(raised); // saturating
        emit OnTimeInstallmentsRecorded(borrower, count, old, a.grade);
    }

    /// @notice Close out a fully repaid plan.
    /// @dev History only. The grade was already credited per installment, so a
    ///      completion bonus here would double-count.
    function recordCompletion(address borrower, bool onTime) external onlyPool {
        Account storage a = _accounts[borrower];
        if (!a.exists) revert UnknownAccount(borrower);
        a.completedPlans += 1;
        emit PlanCompletionRecorded(borrower, onTime, a.completedPlans);
    }

    /// @notice Record a default: write off the remaining balance and downgrade.
    /// @dev Policy is a downgrade, never an A-Pass freeze (ARCHITECTURE.md §3.2).
    ///      A freeze would block the borrower from transferring aUSDC at all,
    ///      which would stop them repaying — the penalty must not destroy the
    ///      means of cure.
    function recordDefault(address borrower, uint256 remaining) external onlyPool {
        Account storage a = _accounts[borrower];
        if (!a.exists) revert UnknownAccount(borrower);

        a.defaults += 1;
        a.outstanding = remaining > a.outstanding ? 0 : a.outstanding - remaining;

        uint8 old = a.grade;
        a.grade = old > GRADE_STEP_DOWN ? old - GRADE_STEP_DOWN : 0; // saturating
        emit DefaultRecorded(borrower, remaining, old, a.grade);
    }

    /// @notice Credit limit implied by a grade: grade * 10 aUSDC, zero if delinquent.
    function limitForGrade(uint8 grade) public pure returns (uint256) {
        if (grade < DELINQUENT_THRESHOLD) return 0;
        return uint256(grade) * LIMIT_PER_GRADE;
    }

    /// @notice Letter band for a grade, matching the published model exactly.
    /// @dev Lives on-chain so the contract and the UI cannot drift: the labels a
    ///      borrower is shown are derived from the same source as the limit they
    ///      are granted. Presentation only — nothing branches on this.
    ///        80+    A          30-49  B
    ///        60-79  A-         10-29  C
    ///        50-59  B+         <10    delinquent
    function gradeBand(uint8 grade) public pure returns (string memory) {
        if (grade < DELINQUENT_THRESHOLD) return "delinquent";
        if (grade < 30) return "C";
        if (grade < 50) return "B";
        if (grade < 60) return "B+";
        if (grade < 80) return "A-";
        return "A";
    }

    /// @notice Letter band for a borrower's current grade.
    function bandOf(address borrower) external view returns (string memory) {
        return gradeBand(_accounts[borrower].grade);
    }

    function accountOf(address borrower) external view returns (Account memory) {
        return _accounts[borrower];
    }

    function exists(address borrower) external view returns (bool) {
        return _accounts[borrower].exists;
    }

    function gradeOf(address borrower) external view returns (uint8) {
        return _accounts[borrower].grade;
    }

    function outstandingOf(address borrower) external view returns (uint256) {
        return _accounts[borrower].outstanding;
    }

    function completedPlansOf(address borrower) external view returns (uint32) {
        return _accounts[borrower].completedPlans;
    }

    function defaultsOf(address borrower) external view returns (uint32) {
        return _accounts[borrower].defaults;
    }

    /// @notice A borrower below the delinquency threshold cannot originate.
    /// @dev An account that does not exist yet is not delinquent — it is simply new.
    function isDelinquent(address borrower) external view returns (bool) {
        Account storage a = _accounts[borrower];
        return a.exists && a.grade < DELINQUENT_THRESHOLD;
    }

    function limitOf(address borrower) public view returns (uint256) {
        Account storage a = _accounts[borrower];
        if (!a.exists) return 0;
        return limitForGrade(a.grade);
    }

    function availableCredit(address borrower) external view returns (uint256) {
        uint256 limit = limitOf(borrower);
        uint256 used = _accounts[borrower].outstanding;
        return used >= limit ? 0 : limit - used;
    }
}
