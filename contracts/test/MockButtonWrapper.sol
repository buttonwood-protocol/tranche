// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IButtonWrapper.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockButtonWrapper is Context, ERC20Burnable, IButtonWrapper {
    uint256 private constant MULTIPLIER_GRANULARITY = 10000;
    uint256 public multiplier = 10000;
    IERC20 public _underlying;

    /**
     * @dev Initializes ERC20 token
     */
    constructor(
        IERC20 underlying_,
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) {
        _underlying = underlying_;
    }

    /**
     * @inheritdoc IButtonWrapper
     * @dev Mints 1 for 1
     */
    function deposit(uint256 uAmount) external override returns (uint256) {
        SafeERC20.safeTransferFrom(_underlying, msg.sender, address(this), uAmount);
        _mint(msg.sender, uAmount);
        return uAmount;
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

    function underlying() external view override returns (address) {
        return address(_underlying);
    }
}
