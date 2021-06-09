pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "./interfaces/ITranche.sol";
import "./external/ERC20.sol";

/**
 * @dev ERC20 token to represent a single tranche for a ButtonTranche bond
 *
 */
contract Tranche is ITranche, ERC20, Initializable, AccessControl {
    address public collateralToken;

    /**
     * @dev Constructor for Tranche ERC20 token
     */
    constructor() ERC20("IMPLEMENTATION", "IMPL") {
        collateralToken = address(0x0);
    }

    /**
     * @dev Constructor for Tranche ERC20 token
     * @param name the ERC20 token name
     * @param symbol The ERC20 token symbol
     * @param admin The admin of this ERC20 token
     * @param _collateralToken The address of the ERC20 collateral token
     */
    function init(
        string memory name,
        string memory symbol,
        address admin,
        address _collateralToken
    ) public initializer {
        super.init(name, symbol);
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        collateralToken = _collateralToken;
    }

    /**
     * @inheritdoc ITranche
     */
    function mint(address to, uint256 amount) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _mint(to, amount);
    }

    /**
     * @inheritdoc ITranche
     */
    function burn(address from, uint256 amount) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _burn(from, amount);
    }

    /**
     * @inheritdoc ITranche
     */
    function redeem(
        address from,
        address to,
        uint256 amount
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        // calculate collateral return value as the proportion of total supply redeemed
        // NOTE: solidity 0.8 has built-in overflow checking so SafeMath is not necessary
        uint256 collateralAmount = (IERC20(collateralToken).balanceOf(address(this)) * amount) / totalSupply();

        _burn(from, amount);
        TransferHelper.safeTransfer(collateralToken, to, collateralAmount);
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Uses the same number of decimals as the collateral token
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view override returns (uint8) {
        return IERC20Metadata(collateralToken).decimals();
    }
}
