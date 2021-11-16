pragma solidity 0.8.3;

import "../interfaces/IBondFactory.sol";
import "../interfaces/IBondMinter.sol";
import "./BondConfigVault.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Canonical Bond Minter
 * @notice Implementation of IBondMinter
 */
contract BondMinter is IBondMinter, Ownable, BondConfigVault {
    IBondFactory public bondFactory;
    uint256 public lastMintTimestamp;
    uint256 public waitingPeriod;

    /**
     * @notice Constructor for IBondMinter
     * @param _bondFactory bondFactory that will be used for minting bonds
     * @param _waitingPeriod minimum waiting period between mints
     */
    constructor(IBondFactory _bondFactory, uint256 _waitingPeriod) {
        bondFactory = _bondFactory;
        lastMintTimestamp = 0;
        waitingPeriod = _waitingPeriod;
    }

    /**
     * @inheritdoc IBondMinter
     * @dev Only the contract owner can call this method
     */
    function setBondFactory(IBondFactory _bondFactory) external override onlyOwner {
        bondFactory = _bondFactory;
    }

    /**
     * @inheritdoc IBondMinter
     * @dev Only the contract owner can call this
     */
    function setWaitingPeriod(uint256 _waitingPeriod) external override onlyOwner {
        waitingPeriod = _waitingPeriod;
    }

    /**
     * @inheritdoc IBondMinter
     * @dev Requires that enough time has passed since last minting. Uses block timestamp to calculate this.
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
