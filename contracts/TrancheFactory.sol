pragma solidity 0.8.3;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./Tranche.sol";
import "./interfaces/ITrancheFactory.sol";

/**
 * @dev Factory for Tranche minimal proxy contracts
 */
contract TrancheFactory is ITrancheFactory {
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
        emit TrancheCreated(clone);
        return clone;
    }
}
