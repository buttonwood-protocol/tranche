pragma solidity 0.8.3;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "./interfaces/IBondFactory.sol";
import "./BondController.sol";

/**
 * @dev Factory for BondController minimal proxy contracts
 */
contract BondFactory is IBondFactory, Context {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    address public target;

    constructor(address _target) {
        target = _target;
    }

    /**
     * @dev Deploys a minimal proxy instance for a new bond with the given parameters.
     */
    function createBond(
        address trancheFactory,
        address _collateralToken,
        uint256[] memory trancheRatios,
        uint256 maturityDate
    ) external override returns (address) {
        address clone = Clones.clone(target);
        BondController(clone).init(trancheFactory, _collateralToken, trancheRatios, maturityDate);
        // to initialize as admin
        BondController(clone).grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        // note the below may not be necessary
        BondController(clone).revokeRole(DEFAULT_ADMIN_ROLE, address(this));
        emit BondCreated(clone);
        return clone;
    }
}
