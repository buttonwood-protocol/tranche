pragma solidity >=0.4;

import "./IBondConfigVault.sol";
import "./IBondFactory.sol";

/**
 * @title BondMinter Interface
 * @notice Interface for canonically minting bonds according to a stored vaults of configurations
 */
interface IBondMinter is IBondConfigVault {
    /**
     * @notice Sets the bondFactory
     * @param _bondFactory The bondFactory that will be used mint the bonds
     */
    function setBondFactory(IBondFactory _bondFactory) external;

    /**
     * @notice Sets the waitingPeriod required between minting periods
     * @param _waitingPeriod The minimum waiting period (in seconds) between mints
     */
    function setWaitingPeriod(uint256 _waitingPeriod) external;

    /**
     * @notice Iterates over configurations and mints bonds for each using the bondFactory
     */
    function mintBonds() external;
}
