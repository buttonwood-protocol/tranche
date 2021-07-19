pragma solidity 0.8.3;

import "./IBondController.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Router for creating loans with tranche
 */
interface ILoanRouter {
    function borrow(
        uint256 amount,
        IBondController bond,
        IERC20 currency,
        uint256[] memory sales,
        uint256 minOutput
    ) external returns (uint256 amountOut);

    function borrowMax(
        uint256 amount,
        IBondController bond,
        IERC20 currency,
        uint256 minOutput
    ) external returns (uint256 amountOut);
}
