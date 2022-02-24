pragma solidity 0.8.4;

import "clones-with-immutable-args/ClonesWithImmutableArgs.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "./Tranche.sol";
import "./interfaces/ITrancheFactory.sol";

/**
 * @dev Factory for Tranche minimal proxy contracts
 */
contract TrancheFactory is ITrancheFactory, Context {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    address public immutable target;

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
        bytes memory data = abi.encodePacked(_collateralToken);
        address clone = ClonesWithImmutableArgs.clone(target, data);
        Tranche(clone).init(name, symbol, _msgSender());
        emit TrancheCreated(clone);
        return clone;
    }
}
