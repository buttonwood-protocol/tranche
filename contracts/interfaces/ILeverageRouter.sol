pragma solidity 0.8.3;

import "./ILoanRouter.sol";
import "./IBondController.sol";
import "./ILoanRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILeverageRouter {
    /**
     * @dev Creates a leveraged long position for the user
     * @param amount The amount of collateral to leverage
     * @param bond The bond leverage with
     * @param loanRouter The LoanRouter to use for accumulating Z-tranches
     * @param currency The currency which has a uniswap pool
     * @param swapBackPath The path to swap back from currency to collateral
     * @param iterations The number of times to swap senior tokens for junior tokens
     * @param minOutput The minimum amount of junior (equity) tokens expected. If less, the function reverts
     * @return amountOut The amount of Z-tranches returned
     */
    function lever(
        uint256 amount,
        IBondController bond,
        ILoanRouter loanRouter,
        IERC20 currency,
        address[] calldata swapBackPath,
        uint256 iterations,
        uint256 minOutput
    ) external returns (uint256 amountOut);
}
