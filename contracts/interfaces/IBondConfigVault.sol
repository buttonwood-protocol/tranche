pragma solidity 0.8.3;

/**
 * @dev Interface for BondConfigVault
 */
interface IBondConfigVault {
    struct BondConfig {
        address collateralToken;
        uint256[] trancheRatios;
        uint256 duration;
    }

    event BondConfigAdded(address collateralToken, uint256[] trancheRatios, uint256 duration);

    event BondConfigRemoved(address collateralToken, uint256[] trancheRatios, uint256 duration);

    /**
     * @dev Adds new bond configuration to internal list
     */
    function addBondConfig(
        address collateralToken,
        uint256[] memory trancheRatios,
        uint256 duration
    ) external;

    /**
     * @dev Removes bond configuration to internal list
     */
    function removeBondConfig(
        address collateralToken,
        uint256[] memory trancheRatios,
        uint256 duration
    ) external;

    /**
     * @dev Returns current number of bondConfigs
     */
    function numConfigs() external view returns (uint256);

    /**
     * @dev Returns bondConfig at current index
     */
    function bondConfigAt(uint256 index) external view returns (BondConfig memory);
}
