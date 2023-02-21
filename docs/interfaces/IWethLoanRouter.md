## `IWethLoanRouter`

Router for creating loans with tranche

### `wrapAndBorrow(contract IBondController bond, contract IERC20 currency, uint256[] sales, uint256 minOutput) → uint256 amountOut` (external)

Borrow against a given bond, wrapping the raw ETH collateral into a WETH ButtonToken first

### `wrapAndBorrowMax(contract IBondController bond, contract IERC20 currency, uint256 minOutput) → uint256 amountOut` (external)

Borrow as much as possible against a given bond,
wrapping the raw ETH collateral into a WETH ButtonToken first
