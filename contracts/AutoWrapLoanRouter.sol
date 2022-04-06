pragma solidity ^0.8.3;

import "./interfaces/ILoanRouter.sol";
import "./interfaces/IBondController.sol";
import "./interfaces/ITranche.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "button-wrappers/contracts/interfaces/IButtonToken.sol";
import "./UniV3LoanRouter.sol";

contract AutoWrapLoanRouter is ILoanRouter {
    UniV3LoanRouter public uniV3LoanRouter;

    constructor(UniV3LoanRouter _uniV3LoanRouter) {
        uniV3LoanRouter = _uniV3LoanRouter;
    }

    function _wrap(address collateralTokenAddress, uint256 underlyingAmount) private returns (uint256) {
        IButtonToken iButtonToken = IButtonToken(collateralTokenAddress);
        IERC20 underlying = IERC20(iButtonToken.underlying());
        SafeERC20.safeTransferFrom(underlying, msg.sender, address(this), underlyingAmount);
        underlying.approve(address(iButtonToken), underlyingAmount);
        uint256 wrapperAmount = iButtonToken.deposit(underlyingAmount);
        iButtonToken.approve(address(uniV3LoanRouter), wrapperAmount);
        return wrapperAmount;
    }

    function _giveAwayTrancheTokensAndLoan(IBondController bond, IERC20 loanCurrency) private returns (bool) {
        for (uint256 i = 0; i < bond.trancheCount(); i++) {
            (ITranche tranche, ) = bond.tranches(i);
            SafeERC20.safeTransfer(tranche, msg.sender, tranche.balanceOf(address(this)));
        }

        SafeERC20.safeTransfer(loanCurrency, msg.sender, loanCurrency.balanceOf(address(this)));
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
        uint256 wrapperAmount = _wrap(bond.collateralToken(), amount);
        uint256 balance = uniV3LoanRouter.borrow(wrapperAmount, bond, currency, sales, minOutput);
        _giveAwayTrancheTokensAndLoan(bond, currency);
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
        uint256 wrapperAmount = _wrap(bond.collateralToken(), amount);
        uint256 balance = uniV3LoanRouter.borrowMax(wrapperAmount, bond, currency, minOutput);
        _giveAwayTrancheTokensAndLoan(bond, currency);
        return balance;
    }
}
