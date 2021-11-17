pragma solidity 0.8.3;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
    // to avoid precision loss and other weird math from a small initial deposit
    // we require at least a minimum initial deposit
    uint256 private constant MINIMUM_FIRST_DEPOSIT = 10e9;

    address public override collateralToken;
    TrancheData[] public override tranches;
    uint256 public override trancheCount;
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
        require(_trancheFactory != address(0), "BondController: invalid trancheFactory address");
        require(_collateralToken != address(0), "BondController: invalid collateralToken address");
        require(_admin != address(0), "BondController: invalid admin address");
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        trancheCount = trancheRatios.length;
        collateralToken = _collateralToken;
        string memory collateralSymbol = IERC20Metadata(collateralToken).symbol();

        uint256 totalRatio;
        for (uint256 i = 0; i < trancheRatios.length; i++) {
            uint256 ratio = trancheRatios[i];
            require(ratio <= TRANCHE_RATIO_GRANULARITY, "BondController: Invalid tranche ratio");
            totalRatio += ratio;

            address trancheTokenAddress = ITrancheFactory(_trancheFactory).createTranche(
                getTrancheName(collateralSymbol, i, trancheRatios.length),
                getTrancheSymbol(collateralSymbol, i, trancheRatios.length),
                _collateralToken
            );
            tranches.push(TrancheData(ITranche(trancheTokenAddress), ratio));
            trancheTokenAddresses[trancheTokenAddress] = true;
        }

        require(totalRatio == TRANCHE_RATIO_GRANULARITY, "BondController: Invalid tranche ratios");
        require(_maturityDate > block.timestamp, "BondController: Invalid maturity date");
        maturityDate = _maturityDate;
    }

    /**
     * @inheritdoc IBondController
     */
    function deposit(uint256 amount) external override {
        require(amount > 0, "BondController: invalid amount");
        require(totalDebt > 0 || amount >= MINIMUM_FIRST_DEPOSIT, "BondController: invalid initial amount");
        require(!isMature, "BondController: Already mature");
        uint256 collateralBalance = IERC20(collateralToken).balanceOf(address(this));
        TransferHelper.safeTransferFrom(collateralToken, _msgSender(), address(this), amount);

        TrancheData[] memory _tranches = tranches;

        uint256 newDebt;
        for (uint256 i = 0; i < _tranches.length; i++) {
            // NOTE: solidity 0.8 checks for over/underflow natively so no need for SafeMath
            uint256 trancheValue = (amount * _tranches[i].ratio) / TRANCHE_RATIO_GRANULARITY;

            // if there is any collateral, we should scale by the debt:collateral ratio
            if (collateralBalance > 0) {
                trancheValue = (trancheValue * totalDebt) / collateralBalance;
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
        require(!isMature, "BondController: Already mature");
        require(
            hasRole(DEFAULT_ADMIN_ROLE, _msgSender()) || maturityDate < block.timestamp,
            "BondController: Invalid call to mature"
        );
        isMature = true;

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

        emit Mature(_msgSender());
    }

    /**
     * @inheritdoc IBondController
     */
    function redeemMature(address tranche, uint256 amount) external override {
        require(isMature, "BondController: Bond is not mature");
        require(trancheTokenAddresses[tranche], "BondController: Invalid tranche address");

        ITranche(tranche).redeem(_msgSender(), _msgSender(), amount);
        totalDebt -= amount;
        emit RedeemMature(_msgSender(), tranche, amount);
    }

    /**
     * @inheritdoc IBondController
     */
    function redeem(uint256[] memory amounts) external override {
        require(!isMature, "BondController: Bond is already mature");

        TrancheData[] memory _tranches = tranches;
        require(amounts.length == _tranches.length, "BondController: Invalid redeem amounts");
        uint256 total;

        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }

        for (uint256 i = 0; i < amounts.length; i++) {
            require(
                (amounts[i] * TRANCHE_RATIO_GRANULARITY) / total == _tranches[i].ratio,
                "BondController: Invalid redemption ratio"
            );
            _tranches[i].token.burn(_msgSender(), amounts[i]);
        }

        uint256 collateralBalance = IERC20(collateralToken).balanceOf(address(this));
        // return as a proportion of the total debt redeemed
        uint256 returnAmount = (total * collateralBalance) / totalDebt;
        totalDebt -= total;
        TransferHelper.safeTransfer(collateralToken, _msgSender(), returnAmount);

        emit Redeem(_msgSender(), amounts);
    }

    /**
     * @dev Get the string name for a tranche
     * @param collateralSymbol the symbol of the collateral token
     * @param index the tranche index
     * @param _trancheCount the total number of tranches
     * @return the string name of the tranche
     */
    function getTrancheName(
        string memory collateralSymbol,
        uint256 index,
        uint256 _trancheCount
    ) internal pure returns (string memory) {
        return
            string(abi.encodePacked("ButtonTranche ", collateralSymbol, " ", getTrancheLetter(index, _trancheCount)));
    }

    /**
     * @dev Get the string symbol for a tranche
     * @param collateralSymbol the symbol of the collateral token
     * @param index the tranche index
     * @param _trancheCount the total number of tranches
     * @return the string symbol of the tranche
     */
    function getTrancheSymbol(
        string memory collateralSymbol,
        uint256 index,
        uint256 _trancheCount
    ) internal pure returns (string memory) {
        return string(abi.encodePacked("TRANCHE-", collateralSymbol, "-", getTrancheLetter(index, _trancheCount)));
    }

    /**
     * @dev Get the string letter for a tranche index
     * @param index the tranche index
     * @param _trancheCount the total number of tranches
     * @return the string letter of the tranche index
     */
    function getTrancheLetter(uint256 index, uint256 _trancheCount) internal pure returns (string memory) {
        bytes memory trancheLetters = bytes("ABCDEFGHIJKLMNOPQRSTUVWXY");
        bytes memory target = new bytes(1);
        if (index == _trancheCount - 1) {
            target[0] = "Z";
        } else {
            target[0] = trancheLetters[index];
        }
        return string(target);
    }
}
