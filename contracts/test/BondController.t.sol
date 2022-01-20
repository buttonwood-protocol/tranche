// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.3;

import "../../lib/ds-test/src/test.sol";
import "../BondController.sol";
import "../mock/MockERC20.sol";
import "./TestUtils.sol";

contract BondControllerTest is DSTest, TestUtils {
    IERC20 collateral;
    BondController bond;

    function setUp() public {
        collateral = new MockERC20("Mock", "MOCK");

        BondFactory factory = TestUtils.createBondFactory();
        uint256[] memory ratios = makeRatiosArray(200, 300, 500);
        bond = BondController(factory.createBond(address(collateral), ratios, block.timestamp + 1000));
    }

    function testGetters() public {
        assertEq(bond.collateralToken(), address(collateral), "collateral");
        assertEq(bond.trancheCount(), 3);
        (, uint256 ratio) = bond.tranches(0);
        assertEq(ratio, 200);
        (, ratio) = bond.tranches(1);
        assertEq(ratio, 300);
        (, ratio) = bond.tranches(2);
        assertEq(ratio, 500);
        assertTrue(!bond.isMature(), "mature");
        assertEq(bond.totalDebt(), 0);
        assertEq(bond.depositLimit(), 0);
        assertEq(bond.feeBps(), 0);
    }

    function testExample() public {
        assertTrue(true);
    }
}
