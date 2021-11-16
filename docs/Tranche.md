## `Tranche`



ERC20 token to represent a single tranche for a ButtonTranche bond



### `constructor()` (public)



Constructor for Tranche ERC20 token

### `init(string name, string symbol, address admin, address _collateralToken)` (public)



Constructor for Tranche ERC20 token


### `mint(address to, uint256 amount)` (external)



Mint `amount` tokens to `to`
 Only callable by the owner (bond controller). Used to
 manage bonds, specifically creating tokens upon deposit


### `burn(address from, uint256 amount)` (external)



Burn `amount` tokens from `from`'s balance
 Only callable by the owner (bond controller). Used to
 manage bonds, specifically burning tokens upon redemption


### `redeem(address from, address to, uint256 amount)` (external)



Burn `amount` tokens from `from` and return the proportional
value of the collateral token to `to`


### `decimals() → uint8` (public)



Returns the number of decimals used to get its user representation.
For example, if `decimals` equals `2`, a balance of `505` tokens should
be displayed to a user as `5,05` (`505 / 10 ** 2`).

Uses the same number of decimals as the collateral token

NOTE: This information is only used for _display_ purposes: it in
no way affects any of the arithmetic of the contract, including
{IERC20-balanceOf} and {IERC20-transfer}.




