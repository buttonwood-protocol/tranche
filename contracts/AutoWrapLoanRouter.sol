pragma solidity ^0.8.3;

import "./interfaces/ILoanRouter.sol";
import "./interfaces/IBondController.sol";
import "./interfaces/ITranche.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "button-wrappers/contracts/interfaces/IButtonToken.sol";
import "./UniV3LoanRouter.sol";

contract AutoWrapLoanRouter is ILoanRouter {
    ILoanRouter public uniV3LoanRouter;

    constructor(ILoanRouter _uniV3LoanRouter) {
        uniV3LoanRouter = _uniV3LoanRouter;
    }

    function _wrap(IBondController bond, uint256 amount) private returns (uint256) {
        IButtonToken iButtonToken = IButtonToken(bond.collateralToken());
        IERC20 underlying = IERC20(iButtonToken.underlying());
        uint256 underlyingAmount = iButtonToken.wrapperToUnderlying(amount);

        SafeERC20.safeTransferFrom(underlying, msg.sender, address(this), underlyingAmount);
        underlying.approve(address(iButtonToken), amount);
        return iButtonToken.mint(amount);
    }

    function _giveAwayTrancheTokens(IBondController bond) private returns (bool) {
        for (uint256 i = 0; i < bond.trancheCount(); i++) {
            (ITranche tranche, ) = bond.tranches(i);
            tranche.transfer(msg.sender, tranche.balanceOf(address(this)));
        }
        return true;
    }

    /**
     * @inheritdoc ILoanRouter
     */
    function borrow(
        uint256 amount,
        IBondController bond,
        IERC20 currency,
        uint256[] memory sales,
        uint256 minOutput
    ) external override returns (uint256 amountOut) {
        _wrap(bond, amount);
        uint256 balance = uniV3LoanRouter.borrow(amount, bond, currency, sales, minOutput);
        _giveAwayTrancheTokens(bond);
        return balance;
    }

    /**
     * @inheritdoc ILoanRouter
     */
    function borrowMax(
        uint256 amount,
        IBondController bond,
        IERC20 currency,
        uint256 minOutput
    ) external override returns (uint256 amountOut) {
        _wrap(bond, amount);
        uint256 balance = uniV3LoanRouter.borrowMax(amount, bond, currency, minOutput);
        _giveAwayTrancheTokens(bond);
        return balance;
    }
}
