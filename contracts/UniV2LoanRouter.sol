pragma solidity ^0.8.3;

import "./LoanRouter.sol";
import "./interfaces/IBondController.sol";
import "./interfaces/ITranche.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./external/IUniswapV2Router.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @dev Loan router for the UniswapV2 AMM
 */
contract UniV2LoanRouter is LoanRouter {
    IUniswapV2Router public uniswapV2Router;

    constructor(IUniswapV2Router _uniswapV2Router) {
        uniswapV2Router = _uniswapV2Router;
    }

    /**
     * @inheritdoc LoanRouter
     */
    function _swap(
        address input,
        address output,
        uint256 amount
    ) internal override {
        IERC20(input).approve(address(uniswapV2Router), amount);
        address[] memory path = new address[](2);
        path[0] = input;
        path[1] = output;
        uniswapV2Router.swapExactTokensForTokens(amount, 0, path, address(this), block.timestamp);
    }
}
