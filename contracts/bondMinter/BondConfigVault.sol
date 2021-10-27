pragma solidity 0.8.3;

import "../interfaces/IBondConfigVault.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title Bond Config Vault
 * @dev BondConfigVault for storing BondConfigs
 */
contract BondConfigVault is IBondConfigVault, Ownable {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    mapping(bytes32 => BondConfig) private bondConfigMapping;
    EnumerableSet.Bytes32Set private configHashes;

    /**
     * @dev Computes the hash of the member variables of a BondConfig struct
     */
    function computeHash(
        address collateralToken_,
        uint256[] memory trancheRatios_,
        uint256 duration_
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(collateralToken_, trancheRatios_, duration_));
    }

    /**
     * @notice Adds a BondConfig into the vault
     * @dev Stores a hash of the bondConfig into `configHashes` and a corresponding entry into `bondConfigMapping`
     */
    function addBondConfig(
        address collateralToken_,
        uint256[] memory trancheRatios_,
        uint256 duration_
    ) external override onlyOwner {
        bytes32 hash = computeHash(collateralToken_, trancheRatios_, duration_);
        configHashes.add(hash);
        bondConfigMapping[hash] = BondConfig(collateralToken_, trancheRatios_, duration_);
        emit BondConfigAdded(collateralToken_, trancheRatios_, duration_);
    }

    /**
     * @notice Removes a BondConfig from the vault
     * @dev Removes the hash of the bondConfig from `configHashes` and the corresponding entry from `bondConfigMapping`
     */
    function removeBondConfig(
        address collateralToken_,
        uint256[] memory trancheRatios_,
        uint256 duration_
    ) external override onlyOwner {
        bytes32 hash = computeHash(collateralToken_, trancheRatios_, duration_);
        configHashes.remove(hash);
        delete bondConfigMapping[hash];
        emit BondConfigRemoved(collateralToken_, trancheRatios_, duration_);
    }

    /**
     * @return The number of configs stored in the vault
     * @dev Retrieves the length of `configHashes`
     */
    function numConfigs() public view override returns (uint256) {
        return configHashes.length();
    }

    /**
     * @return The number the config stored at `index`
     * @notice No guarantees are made on the ordering
     * @dev Retrieves the hash at `index` and returns corresponding value from `bondConfigMapping`
     */
    function bondConfigAt(uint256 index) public view override returns (BondConfig memory) {
        return bondConfigMapping[configHashes.at(index)];
    }
}
