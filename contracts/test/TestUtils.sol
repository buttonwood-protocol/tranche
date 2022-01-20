// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.3;

import "../../lib/ds-test/src/test.sol";
import "../TrancheFactory.sol";
import "../BondFactory.sol";
import "../mock/MockERC20.sol";

contract TestUtils {
    function createTrancheFactory() public returns (TrancheFactory) {
        Tranche template = new Tranche();
        // initialize template with dummy data
        template.init("template", "TEMP", address(this), address(this));
        return new TrancheFactory(address(template));
    }

    function createBondFactory() public returns (BondFactory) {
        TrancheFactory trancheFactory = createTrancheFactory();

        BondController template = new BondController();
        IERC20 collateral = new MockERC20("Mock", "MOCK");

        uint256[] memory ratios = makeRatiosArray(200, 300, 500);
        template.init(address(trancheFactory), address(collateral), address(this), ratios, block.timestamp + 1000, 0);
        return new BondFactory(address(template), address(trancheFactory));
    }

    function makeRatiosArray(uint256 first, uint256 second, uint256 third) public returns (uint256[] memory) {
        uint256[] memory ratios = new uint256[](3);
        ratios[0] = 200;
        ratios[1] = 300;
        ratios[2] = 500;
        return ratios;
    }
}
