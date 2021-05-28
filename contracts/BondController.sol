pragma solidity 0.8.3;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "./interfaces/IBondController.sol";
import "./interfaces/ITrancheFactory.sol";
import "./interfaces/ITranche.sol";

/**
 * @dev Controller for a ButtonTranche bond
 *
 * Invariants:
 *  - `totalDebt` should always equal the sum of all tranche tokens' `totalSupply()`
 */
contract BondController is IBondController, Initializable, AccessControl {
    uint256 private constant TRANCHE_RATIO_GRANULARITY = 1000;

    address public collateralToken;
    TrancheData[] public tranches;
    mapping(address => bool) public trancheTokenAddresses;
    uint256 public maturityDate;
    bool public isMature;
    uint256 public totalDebt;

    /**
     * @dev Constructor for Tranche ERC20 token
     * @param _trancheFactory The address of the tranche factory
     * @param _collateralToken The address of the ERC20 collateral token
     * @param _admin The address of the initial admin for this contract
     * @param trancheRatios The tranche ratios for this bond
     * @param _maturityDate The date timestamp in seconds at which this bond matures
     */
    function init(
        address _trancheFactory,
        address _collateralToken,
        address _admin,
        uint256[] memory trancheRatios,
        uint256 _maturityDate
    ) external initializer {
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        collateralToken = _collateralToken;
        uint256 totalRatio = 0;

        for (uint256 i = 0; i < trancheRatios.length; i++) {
            uint256 ratio = trancheRatios[i];
            require(ratio <= TRANCHE_RATIO_GRANULARITY, "Invalid tranche ratio");
            totalRatio += ratio;

            address trancheTokenAddress =
                ITrancheFactory(_trancheFactory).createTranche("ButtonTranche token", "TRANCHE", _collateralToken);
            tranches.push(TrancheData(ITranche(trancheTokenAddress), ratio));
            trancheTokenAddresses[trancheTokenAddress] = true;
        }

        require(totalRatio == TRANCHE_RATIO_GRANULARITY, "Invalid total tranche ratios");
        require(_maturityDate > block.timestamp, "Invalid maturity date");
        maturityDate = _maturityDate;
    }

    /**
     * @inheritdoc IBondController
     */
    function deposit(uint256 amount) external override {
        uint256 collateralBalance = IERC20(collateralToken).balanceOf(address(this));
        TransferHelper.safeTransferFrom(collateralToken, _msgSender(), address(this), amount);

        TrancheData[] memory _tranches = tranches;

        uint256 newDebt = 0;
        for (uint256 i = 0; i < _tranches.length; i++) {
            // NOTE: solidity 0.8 checks for over/underflow natively so no need for SafeMath
            uint256 trancheValue = (amount * _tranches[i].ratio) / TRANCHE_RATIO_GRANULARITY;

            // if there is any collateral, we should scale by the collateral:debt ratio
            if (collateralBalance > 0) {
                trancheValue = (trancheValue * collateralBalance) / totalDebt;
            }
            newDebt += trancheValue;

            _tranches[i].token.mint(_msgSender(), trancheValue);
        }

        totalDebt += newDebt;
        emit Deposit(_msgSender(), amount);
    }

    /**
     * @inheritdoc IBondController
     */
    function mature() external override {
        require(!isMature, "Bond is already mature");
        require(
            hasRole(DEFAULT_ADMIN_ROLE, _msgSender()) || maturityDate < block.timestamp,
            "No permissions to call mature"
        );

        TrancheData[] memory _tranches = tranches;
        uint256 collateralBalance = IERC20(collateralToken).balanceOf(address(this));
        // Go through all tranches A-Y (not Z) delivering collateral if possible
        for (uint256 i = 0; i < _tranches.length - 1 && collateralBalance > 0; i++) {
            uint256 trancheSupply = _tranches[i].token.totalSupply();
            uint256 amount = Math.min(trancheSupply, collateralBalance);

            TransferHelper.safeTransfer(collateralToken, address(_tranches[i].token), amount);
            collateralBalance -= amount;
        }

        // Transfer any remaining collaeral to the Z tranche
        if (collateralBalance > 0) {
            TransferHelper.safeTransfer(
                collateralToken,
                address(_tranches[_tranches.length - 1].token),
                collateralBalance
            );
        }

        isMature = true;
        emit Mature(_msgSender());
    }

    /**
     * @inheritdoc IBondController
     */
    function redeemMature(address tranche, uint256 amount) external override {
        require(isMature, "Bond is not mature");
        require(trancheTokenAddresses[tranche], "Invalid tranche address");

        ITranche(tranche).redeem(_msgSender(), _msgSender(), amount);
        totalDebt -= amount;
        emit RedeemMature(_msgSender(), tranche, amount);
    }

    /**
     * @inheritdoc IBondController
     */
    function redeem(uint256[] memory amounts) external override {
        require(isMature, "Bond is mature");

        TrancheData[] memory _tranches = tranches;
        require(amounts.length == _tranches.length, "Invalid redeem amounts");
        uint256 total = 0;

        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }

        for (uint256 i = 0; i < amounts.length; i++) {
            // NOTE: this might not always hold true due to precision issues
            // Maybe use a threshold?
            require((amounts[i] * 1000) / total == _tranches[i].ratio, "Invalid redemption ratio");
            _tranches[i].token.burn(_msgSender(), amounts[i]);
        }

        uint256 collateralBalance = IERC20(collateralToken).balanceOf(address(this));
        // return as a proportion of the total debt redeemed
        uint256 returnAmount = (total / totalDebt) * collateralBalance;
        totalDebt -= total;
        TransferHelper.safeTransfer(collateralToken, _msgSender(), returnAmount);

        emit Redeem(_msgSender(), amounts);
    }
}
