pragma solidity ^0.8.3;

import "./interfaces/IWethLoanRouter.sol";
import "./interfaces/ILoanRouter.sol";
import "./interfaces/IBondController.sol";
import "./interfaces/ITranche.sol";
import "./interfaces/IButtonWrapper.sol";
// ToDo: @mark-toda, Do you want me to import this from button-wrappers or copy interface here
import "./interfaces/IWETH.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @dev Weth Loan Router built on top of a LoanRouter of your choosing
 * to allow loans to be created with raw ETH instead of WETH
 */
contract WethLoanRouter is IWethLoanRouter {
    ILoanRouter public loanRouter;
    IWETH9 public weth;

    constructor(ILoanRouter _loanRouter, IWETH9 _weth) {
        loanRouter = _loanRouter;
        weth = _weth;
    }

    function _wethWrap(IBondController bond) internal returns (uint256) {
        // Confirm that ETH was sent
        uint256 value = msg.value;
        require(value > 0, "ButtonTokenWethRouter: No ETH supplied");

        // Confirm that bond's collateral has WETH as underlying
        IButtonWrapper wrapper = IButtonWrapper(bond.collateralToken());
        require(wrapper.underlying() == address(weth), "Collateral Token underlying does not match WETH address.");

        // Wrapping ETH into weth
        weth.deposit{ value: value }();

        // Approve loanRouter to take weth
        uint256 wethBalance = weth.balanceOf(address(this));
        weth.approve(address(loanRouter), wethBalance);
        return wethBalance;
    }

    function _distributeLoanOutput(
        uint256 amountOut,
        IBondController bond,
        IERC20 currency
    ) internal {
        // Send loan currenncy out from this contract to msg.sender
        SafeERC20.safeTransfer(currency, msg.sender, amountOut);

        // Send out the tranche tokens from this contract to the msg.sender
        ITranche tranche;
        for (uint256 i = 0; i < bond.trancheCount(); i++) {
            (tranche, ) = bond.tranches(i);
            SafeERC20.safeTransfer(tranche, msg.sender, tranche.balanceOf(address(this)));
        }
    }

    /**
     * @inheritdoc IWethLoanRouter
     */
    function wrapAndBorrow(
        IBondController bond,
        IERC20 currency,
        uint256[] memory sales,
        uint256 minOutput
    ) external payable override returns (uint256 amountOut) {
        uint256 wethBalance = _wethWrap(bond);
        uint256 loanAmountOut = loanRouter.wrapAndBorrow(wethBalance, bond, currency, sales, minOutput);
        _distributeLoanOutput(loanAmountOut, bond, currency);
        return loanAmountOut;
    }

    /**
     * @inheritdoc IWethLoanRouter
     */
    function wrapAndBorrowMax(
        IBondController bond,
        IERC20 currency,
        uint256 minOutput
    ) external payable override returns (uint256 amountOut) {
        uint256 wethBalance = _wethWrap(bond);
        uint256 loanAmountOut = loanRouter.wrapAndBorrowMax(wethBalance, bond, currency, minOutput);
        _distributeLoanOutput(loanAmountOut, bond, currency);
        return loanAmountOut;
    }
}
