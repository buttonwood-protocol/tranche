// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract MockERC20CustomDecimals is Context, ERC20Burnable {
    uint256 private constant MULTIPLIER_GRANULARITY = 10000;
    uint256 public multiplier = 10000;
    uint8 public _decimals;

    /**
     * @dev Initializes ERC20 token
     */
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    /**
     * @dev Creates `amount` new tokens for `to`. Public for any test to call.
     *
     * See {ERC20-_mint}.
     */
    function mint(address to, uint256 amount) public virtual {
        _mint(to, amount);
    }

    function rebase(uint256 _multiplier) external {
        multiplier = _multiplier;
    }

    function transfer(address who, uint256 amount) public override returns (bool) {
        // transfer actual amount with the multiplier divided out, so balances line up
        return super.transfer(who, (amount * MULTIPLIER_GRANULARITY) / multiplier);
    }

    function balanceOf(address who) public view override returns (uint256) {
        // multiply underlying balance to accommodate current rebase multiplier
        return (super.balanceOf(who) * multiplier) / MULTIPLIER_GRANULARITY;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
