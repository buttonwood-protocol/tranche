pragma solidity ^0.8.3;

import "./interfaces/ILoanRouter.sol";
import "./interfaces/ILeverageRouter.sol";
import "./interfaces/IBondController.sol";
import "./external/IUniswapV2Router.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @dev Router to create a leveraged long position, maximizing the amount of Z-tranche tokens held
 */
contract UniV2LeverageRouter is ILeverageRouter {
    uint256 public constant MAX_UINT256 = type(uint256).max;
    IUniswapV2Router public uniswapV2Router;

    constructor(IUniswapV2Router _uniswapV2Router) {
        uniswapV2Router = _uniswapV2Router;
    }

    /**
     * @inheritdoc ILeverageRouter
     */
    function lever(
        uint256 amount,
        IBondController bond,
        ILoanRouter loanRouter,
        IERC20 currency,
        address[] calldata swapBackPath,
        uint256 iterations,
        uint256 minOutput
    ) external override returns (uint256 amountOut) {
        IERC20 collateral = IERC20(bond.collateralToken());
        require(address(collateral) != address(currency), "LeverageRouter: Invalid currency");

        SafeERC20.safeTransferFrom(collateral, msg.sender, address(this), amount);

        for (uint256 i = 0; i < iterations; i++) {
            uint256 balance = collateral.balanceOf(address(this));
            collateral.approve(address(loanRouter), balance);
            loanRouter.borrowMax(balance, bond, currency, 0);

            _swapBack(swapBackPath, currency.balanceOf(address(this)));
        }

        (IERC20 zTranche, ) = bond.tranches(bond.trancheCount() - 1);
        amountOut = zTranche.balanceOf(address(this));
        require(amountOut >= minOutput, "LeverageRouter: Insufficient output");

        // return proceeds to the user
        zTranche.transfer(msg.sender, amountOut);
        collateral.transfer(msg.sender, collateral.balanceOf(address(this)));
    }

    /**
     * @dev Swap the currency token back into the collateral token
     * @param swapBackPath The path of tokens to swap between
     * @param amount The amount of input tokens to swap
     */
    function _swapBack(address[] calldata swapBackPath, uint256 amount) internal {
        address input = swapBackPath[0];
        IERC20(input).approve(address(uniswapV2Router), amount);
        uniswapV2Router.swapExactTokensForTokens(amount, 0, swapBackPath, address(this), block.timestamp);
    }
}
