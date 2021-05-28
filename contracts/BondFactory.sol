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
    address public trancheFactory;
    mapping(bytes32 => address) public bonds;

    constructor(address _target, address _trancheFactory) {
        target = _target;
        trancheFactory = _trancheFactory;
    }

    /**
     * @dev Deploys a minimal proxy instance for a new bond with the given parameters.
     */
    function createBond(
        address _collateralToken,
        uint256[] memory trancheRatios,
        uint256 maturityDate
    ) external override returns (address) {
        bytes32 bondHash = keccak256(abi.encodePacked(_collateralToken, maturityDate, trancheRatios));
        require(bonds[bondHash] == address(0), "BondFactory: Bond already exists");

        address clone = Clones.clone(target);
        bonds[bondHash] = clone;
        BondController(clone).init(trancheFactory, _collateralToken, _msgSender(), trancheRatios, maturityDate);

        emit BondCreated(clone);
        return clone;
    }
}
