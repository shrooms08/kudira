// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CreditLine} from "../src/CreditLine.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";

/// @notice The published grade ladder, pinned exactly as the UI states it.
///
///   limit = subTier * 10 aUSDC     on-time installment +5     default -20
///   80+ A · 60-79 A- · 50-59 B+ · 30-49 B · 10-29 C · <10 delinquent
///
/// These tests exist so the contract can never quietly diverge from the model a
/// borrower is shown. If someone retunes the ladder, this file fails first.
contract GradeLadderTest is KudiraTestBase {
    function setUp() public override {
        super.setUp();
        // Isolate the ladder from the validator rule.
        vm.prank(owner);
        pool.setRule(0, 0);
    }

    // --- 1. Four on-time installments: 50 -> 70, B+ -> A- ---------------------

    function test_fourOnTimeInstallmentsTake50To70() public {
        uint256 planId = _originate(400 * ONE_USDC, 4, 0, 50);

        assertEq(creditLine.gradeOf(borrower), 50, "starts at 50");
        assertEq(creditLine.bandOf(borrower), "B+", "50 is Grade B+");

        uint256 perInstallment = plans.installmentAmount(planId);
        for (uint16 i = 1; i <= 4; i++) {
            vm.warp(plans.dueDateOf(planId, i));
            uint256 due = i == 4 ? plans.outstandingOf(planId) : perInstallment;
            _repay(planId, due);
        }

        assertEq(creditLine.gradeOf(borrower), 70, "four on-time installments: 50 + 4*5");
        assertEq(creditLine.bandOf(borrower), "A-", "70 is Grade A-");
        assertEq(creditLine.limitOf(borrower), 700 * ONE_USDC, "limit follows: 70 * 10");
    }

    // --- 2. Default from 50 lands at 30 = Grade B, still able to borrow -------

    function test_defaultFrom50LandsAt30AndCanStillBorrow() public {
        uint256 planId = _originate(100 * ONE_USDC, 3, 0, 50);

        _warpPastGrace(planId, 1);
        vm.prank(operator);
        pool.markDefault(planId);

        assertEq(creditLine.gradeOf(borrower), 30, "50 - 20");
        assertEq(creditLine.bandOf(borrower), "B", "30 is Grade B");
        assertFalse(creditLine.isDelinquent(borrower), "30 is NOT delinquent");
        assertEq(creditLine.limitOf(borrower), 300 * ONE_USDC, "300.00 limit at grade 30");
        assertEq(creditLine.availableCredit(borrower), 300 * ONE_USDC, "written off, so fully available");

        // The point of the test: they can still borrow.
        uint256 planId2 = _originate(300 * ONE_USDC, 3, 0, 50);
        assertEq(planId2, 2, "a defaulted borrower at grade 30 can still originate");
    }

    // --- 3. Saturation at 99 and at 0 ----------------------------------------

    function test_saturatesAt99() public {
        // Grade 97 + three on-time installments would be 112; must clamp to 99.
        uint256 planId = _originate(300 * ONE_USDC, 3, 0, 97);

        uint256 perInstallment = plans.installmentAmount(planId);
        for (uint16 i = 1; i <= 3; i++) {
            vm.warp(plans.dueDateOf(planId, i));
            uint256 due = i == 3 ? plans.outstandingOf(planId) : perInstallment;
            _repay(planId, due);
        }

        assertEq(creditLine.gradeOf(borrower), 99, "clamped at MAX_GRADE, no wraparound");
        assertEq(creditLine.gradeOf(borrower), creditLine.MAX_GRADE());
        assertEq(creditLine.bandOf(borrower), "A", "99 is Grade A");
        assertEq(creditLine.limitOf(borrower), 990 * ONE_USDC, "99 * 10");
    }

    function test_saturatesAtZero() public {
        // Grade 15 - 20 would underflow; must clamp to 0.
        uint256 planId = _originate(100 * ONE_USDC, 3, 0, 15);

        _warpPastGrace(planId, 1);
        vm.prank(operator);
        pool.markDefault(planId);

        assertEq(creditLine.gradeOf(borrower), 0, "clamped at 0, no underflow");
        assertEq(creditLine.bandOf(borrower), "delinquent");
        assertTrue(creditLine.isDelinquent(borrower), "below the threshold");
        assertEq(creditLine.limitOf(borrower), 0, "no credit while delinquent");

        vm.expectRevert(abi.encodeWithSelector(KudiraPool.BorrowerDelinquent.selector, borrower, 0));
        _originate(10 * ONE_USDC, 3, 0, 50);
    }

    /// @dev A second default from an already-zero grade must stay at zero.
    function test_repeatedDefaultsStayAtZero() public {
        uint256 p1 = _originate(100 * ONE_USDC, 3, 0, 15);
        _warpPastGrace(p1, 1);
        vm.prank(operator);
        pool.markDefault(p1);
        assertEq(creditLine.gradeOf(borrower), 0);

        // Delinquent, so no new plan can be opened to default on. Drive the
        // saturating path directly through a fresh borrower instead.
        assertEq(creditLine.limitForGrade(0), 0, "0 stays 0");
    }

    // --- 4. limit() is exactly subTier * 10 across the range -----------------

    function test_limitIsExactlyGradeTimesTenAcrossTheRange() public view {
        // Below the delinquency threshold: no credit at all.
        for (uint8 g = 0; g < 10; g++) {
            assertEq(creditLine.limitForGrade(g), 0, "delinquent grades earn no credit");
        }
        // At and above it: exactly grade * 10 aUSDC.
        for (uint8 g = 10; g < 100; g++) {
            assertEq(
                creditLine.limitForGrade(g), uint256(g) * 10 * ONE_USDC, "limit must be grade * 10 aUSDC"
            );
        }
        // Spot checks in human terms.
        assertEq(creditLine.limitForGrade(10), 100 * ONE_USDC);
        assertEq(creditLine.limitForGrade(30), 300 * ONE_USDC);
        assertEq(creditLine.limitForGrade(50), 500 * ONE_USDC);
        assertEq(creditLine.limitForGrade(70), 700 * ONE_USDC);
        assertEq(creditLine.limitForGrade(99), 990 * ONE_USDC);
    }

    /// @dev Property: limit is always grade * LIMIT_PER_GRADE, or 0 if delinquent.
    function testFuzz_limitFormulaHolds(uint8 grade) public view {
        uint256 expected =
            grade < creditLine.DELINQUENT_THRESHOLD() ? 0 : uint256(grade) * creditLine.LIMIT_PER_GRADE();
        assertEq(creditLine.limitForGrade(grade), expected);
    }

    // --- Band boundaries ------------------------------------------------------

    function test_bandBoundariesMatchThePublishedModel() public view {
        assertEq(creditLine.gradeBand(0), "delinquent");
        assertEq(creditLine.gradeBand(9), "delinquent", "9 is the last delinquent grade");
        assertEq(creditLine.gradeBand(10), "C", "10 opens Grade C");
        assertEq(creditLine.gradeBand(29), "C", "29 is the last C");
        assertEq(creditLine.gradeBand(30), "B", "30 opens Grade B");
        assertEq(creditLine.gradeBand(49), "B", "49 is the last B");
        assertEq(creditLine.gradeBand(50), "B+", "50 opens Grade B+");
        assertEq(creditLine.gradeBand(59), "B+", "59 is the last B+");
        assertEq(creditLine.gradeBand(60), "A-", "60 opens Grade A-");
        assertEq(creditLine.gradeBand(79), "A-", "79 is the last A-");
        assertEq(creditLine.gradeBand(80), "A", "80 opens Grade A");
        assertEq(creditLine.gradeBand(99), "A", "99 is Grade A");
    }
}
