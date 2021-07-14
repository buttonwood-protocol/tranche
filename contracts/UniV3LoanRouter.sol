pragma solidity ^0.8.3;

import "hardhat/console.sol";
import "./interfaces/ILoanRouter.sol";
import "./interfaces/IBondController.sol";
import "./interfaces/ITranche.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

contract UniV3LoanRouter is ILoanRouter {
    uint256 public constant MAX_UINT256 = 2**256 - 1;
    ISwapRouter public uniswapV3Router;

    constructor(ISwapRouter _uniswapV3Router) {
        uniswapV3Router = _uniswapV3Router;
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
    ) external override {
        _borrow(amount, bond, currency, sales, minOutput);
    }

    /**
     * @inheritdoc ILoanRouter
     */
    function borrowMax(
        uint256 amount,
        IBondController bond,
        IERC20 currency,
        uint256 minOutput
    ) external override {
        uint256 trancheCount = bond.trancheCount();
        uint256[] memory sales = new uint256[](trancheCount);
        // sell all tokens except the last one (Z token)
        for (uint256 i = 0; i < trancheCount - 1; i++) {
            sales[i] = MAX_UINT256;
        }

        _borrow(amount, bond, currency, sales, minOutput);
    }

    /**
     * @dev Internal function to borrow a given currency from a given collateral
     * @param amount The amount of the collateral to deposit
     * @param bond The bond to deposit with
     * @param currency The currency to borrow
     * @param sales The amount of each tranche to sell for the currency.
     *  If MAX_UNT256, then sell full balance of the token
     * @param minOutput The minimum amount of currency that should be recived, else reverts
     */
    function _borrow(
        uint256 amount,
        IBondController bond,
        IERC20 currency,
        uint256[] memory sales,
        uint256 minOutput
    ) internal {
        IERC20 collateral = IERC20(bond.collateralToken());
        collateral.transferFrom(msg.sender, address(this), amount);
        collateral.approve(address(bond), amount);
        bond.deposit(amount);

        uint256 trancheCount = bond.trancheCount();
        require(trancheCount == sales.length, "Invalid sales");
        ITranche tranche;
        for (uint256 i = 0; i < trancheCount; i++) {
            (tranche, ) = bond.tranches(i);
            uint256 sale = sales[i];
            uint256 trancheBalance = tranche.balanceOf(address(this));

            if (sale == MAX_UINT256) {
                sale = trancheBalance;
            } else if (sale == 0) {
                tranche.transfer(msg.sender, trancheBalance);
                continue;
            } else {
                // transfer any excess to the caller
                tranche.transfer(msg.sender, trancheBalance - sale);
            }

            tranche.approve(address(uniswapV3Router), sale);
            uniswapV3Router.exactInputSingle(
                ISwapRouter.ExactInputSingleParams(
                    address(tranche),
                    address(currency),
                    3000,
                    address(this),
                    block.timestamp,
                    sale,
                    0,
                    0
                )
            );
        }

        uint256 balance = currency.balanceOf(address(this));
        require(balance >= minOutput, "UniV3LoanRouter: Insufficient output");
        currency.transfer(msg.sender, balance);
    }
}
