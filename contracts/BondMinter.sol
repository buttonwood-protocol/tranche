pragma solidity 0.8.3;

import "./interfaces/IBondMinter.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import "./BondConfigVault.sol";
import "./interfaces/IBondFactory.sol";

/**
 * @dev  for Canonical Bond Minter
 */

contract BondMinter is IBondMinter, BondConfigVault {
    address public immutable bondFactory;

    constructor(address _bondFactory) {
        bondFactory = _bondFactory;
    }

    /**
     * @dev Iterates over configurations an mints bonds for each
     */
    function mintBonds() external override {
        for (uint256 i = 0; i < numConfigs(); i++) {
            BondConfig memory bondConfig = bondConfigAt(i);
            IBondFactory(bondFactory).createBond(
                bondConfig.collateralToken,
                bondConfig.trancheRatios,
                block.timestamp + bondConfig.duration
            );
        }
    }
}
