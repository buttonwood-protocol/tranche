pragma solidity 0.8.3;

import "./interfaces/IBondConfigVault.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @dev BonddConfigVault for storing BondConfigs
 */
contract BondConfigVault is IBondConfigVault, Ownable {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    mapping(bytes32 => BondConfig) private bondConfigMapping;
    EnumerableSet.Bytes32Set private configHashes;

    function computeHash(
        address collateralToken_,
        uint256[] memory trancheRatios_,
        uint256 duration_
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(collateralToken_, trancheRatios_, duration_));
    }

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

    function numConfigs() public view override returns (uint256) {
        return configHashes.length();
    }

    function bondConfigAt(uint256 index) public view override returns (BondConfig memory) {
        return bondConfigMapping[configHashes.at(index)];
    }
}
