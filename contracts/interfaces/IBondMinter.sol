pragma solidity 0.8.3;

/**
 * @dev Interface for BondMinter
 */
interface IBondMinter {
    /**
     * @dev Iterates over configurations an mints bonds for each
     */
    function mintBonds() external;
}
