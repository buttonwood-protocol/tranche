pragma solidity 0.8.3;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "./Tranche.sol";
import "./interfaces/ITrancheFactory.sol";

/**
 * @dev Factory for Tranche minimal proxy contracts
 */
contract TrancheFactory is ITrancheFactory, Context {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    address public target;

    constructor(address _target) {
        target = _target;
    }

    /**
     * @inheritdoc ITrancheFactory
     */
    function createTranche(
        string memory name,
        string memory symbol,
        address _collateralToken
    ) external override returns (address) {
        address clone = Clones.clone(target);
        Tranche(clone).init(name, symbol, _collateralToken);
        // note we could instead just pass the _msgSender as a param
        // to initialize as admin
        Tranche(clone).grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        // note the below may not be necessary
        Tranche(clone).revokeRole(DEFAULT_ADMIN_ROLE, address(this));
        emit TrancheCreated(clone);
        return clone;
    }
}
