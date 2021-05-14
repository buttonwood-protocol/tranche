pragma solidity 0.8.3;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./interfaces/IBondFactory.sol";
import "./BondController.sol";

/**
 * @dev Factory for BondController minimal proxy contracts
 */
contract BondFactory is IBondFactory {
    address public target;

    constructor(address _target) {
        target = _target;
    }

    /**
     * @dev Deploys a minimal proxy instance for a new bond with the given parameters.
     */
    function createBond(
        address _collateralToken,
        uint256[] memory trancheRatios,
        uint256 maturityDate
    ) external override returns (address) {
        address clone = Clones.clone(target);
        BondController(clone).init(address(this), _collateralToken, trancheRatios, maturityDate);
        emit BondCreated(clone);
        return clone;
    }
}
