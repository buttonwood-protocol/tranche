pragma solidity 0.8.3;

import "./interfaces/IBondFactory.sol";
import "./interfaces/IBondMinter.sol";
import "./BondConfigVault.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @dev  for Canonical Bond Minter
 */

contract BondMinter is IBondMinter, Ownable, BondConfigVault {
    IBondFactory public immutable bondFactory;
    uint256 private lastMintTimestamp;
    uint256 public waitingPeriod;

    constructor(IBondFactory _bondFactory, uint256 _waitingPeriod) {
        bondFactory = _bondFactory;
        lastMintTimestamp = 0;
        waitingPeriod = _waitingPeriod;
    }

    /**
     * @dev Sets the waitingPeriod required between minting periods
     */
    function setWaitingPeriod(uint256 _waitingPeriod) external override onlyOwner {
        waitingPeriod = _waitingPeriod;
    }

    /**
     * @dev Iterates over configurations an mints bonds for each
     */
    function mintBonds() external override {
        require(
            block.timestamp - lastMintTimestamp >= waitingPeriod,
            "Not enough time has passed since last mint timestamp."
        );
        lastMintTimestamp = block.timestamp;

        for (uint256 i = 0; i < numConfigs(); i++) {
            BondConfig memory bondConfig = bondConfigAt(i);
            bondFactory.createBond(
                bondConfig.collateralToken,
                bondConfig.trancheRatios,
                block.timestamp + bondConfig.duration
            );
        }
    }
}
