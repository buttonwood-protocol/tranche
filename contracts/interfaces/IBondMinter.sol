pragma solidity >=0.4;

import "./IBondConfigVault.sol";
import "./IBondFactory.sol";

/**
 * @dev Interface for BondMinter
 */
interface IBondMinter is IBondConfigVault {
    /**
     * @dev Sets the bondFactory
     */
    function setBondFactory(IBondFactory _bondFactory) external;

    /**
     * @dev Sets the waitingPeriod required between minting periods
     */
    function setWaitingPeriod(uint256 _waitingPeriod) external;

    /**
     * @dev Iterates over configurations and mints bonds for each
     */
    function mintBonds() external;
}
