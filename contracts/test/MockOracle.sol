// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.4;

import "button-wrappers/contracts/interfaces/IOracle.sol";

/**
 * @title Mock oracle
 */
contract MockOracle is IOracle {
    uint256 private data;
    bool private success;

    /**
     * Return mocked data returned by the oracle
     */
    function getData() external view override returns (uint256, bool) {
        return (data, success);
    }

    /**
     * Return sets the mocked data
     */
    function setData(uint256 dt, bool v) external {
        data = dt;
        success = v;
    }
}
