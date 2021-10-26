/**
 * @dev Interface for BondMinter
 */
interface IBondMinter {
    /**
     * @dev Sets the waitingPeriod required between minting periods
     */
    function setWaitingPeriod(uint256 _waitingPeriod) external;

    /**
     * @dev Iterates over configurations an mints bonds for each
     */
    function mintBonds() external;
}
