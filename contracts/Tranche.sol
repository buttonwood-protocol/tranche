pragma solidity 0.8.3;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "./interfaces/ITranche.sol";
import "./external/ERC20.sol";

/**
 * @dev ERC20 token to represent a single tranche for a ButtonTranche bond
 *
 */
contract Tranche is ITranche, ERC20, Ownable, Initializable {
    address public collateralToken;

    /**
     * @dev Constructor for Tranche ERC@0 token
     * @param name the ERC20 token name
     * @param symbol The ERC20 token symbol
     * @param _collateralToken The address of the ERC20 collateral token
     */
    constructor(
        string memory name,
        string memory symbol,
        address _collateralToken
    ) ERC20(name, symbol) {
        collateralToken = _collateralToken;
    }

    /**
     * @dev Constructor for Tranche ERC@0 token
     * @param name the ERC20 token name
     * @param symbol The ERC20 token symbol
     * @param _collateralToken The address of the ERC20 collateral token
     */
    function init(
        string memory name,
        string memory symbol,
        address _collateralToken
    ) public initializer {
        super.init(name, symbol);
        collateralToken = _collateralToken;
    }

    /**
     * @inheritdoc ITranche
     */
    function mint(address to, uint256 amount) external override onlyOwner {
        _mint(to, amount);
    }

    /**
     * @inheritdoc ITranche
     */
    function burn(address from, uint256 amount) external override onlyOwner {
        _burn(from, amount);
    }

    /**
     * @inheritdoc ITranche
     */
    function redeem(
        address from,
        address to,
        uint256 amount
    ) external override onlyOwner {
        // calculate collateral return value as the proportion of total supply redeemed
        // NOTE: solidity 0.8 has built-in overflow checking so SafeMath is not necessary
        uint256 collateralAmount = (IERC20(collateralToken).balanceOf(address(this)) * amount) / totalSupply();

        _burn(from, amount);
        TransferHelper.safeTransfer(collateralToken, to, collateralAmount);
    }
}
