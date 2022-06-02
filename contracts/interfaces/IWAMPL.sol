// SPDX-License-Identifier: GPL-3.0-or-later
// from https://github.com/buttonwood-protocol/button-wrappers
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Interface definition for WETH contract, which wraps ETH into an ERC20 token.
interface IWAMPL is IERC20 {
    /// @notice Transfers AMPLs from {msg.sender} and mints wAMPLs.
    ///
    /// @param amples The amount of AMPLs to deposit.
    /// @return The amount of wAMPLs minted.
    function deposit(uint256 amples) external returns (uint256);
}
