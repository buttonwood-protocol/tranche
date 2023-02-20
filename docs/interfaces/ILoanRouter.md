## `ILoanRouter`

Router for creating loans with tranche

### `wrapAndBorrow(uint256 underlyingAmount, contract IBondController bond, contract IERC20 currency, uint256[] sales, uint256 minOutput) → uint256 amountOut` (external)

Borrow against a given bond, wrapping the raw collateral into a ButtonToken first

### `wrapAndBorrowMax(uint256 underlyingAmount, contract IBondController bond, contract IERC20 currency, uint256 minOutput) → uint256 amountOut` (external)

Borrow as much as possible against a given bond, wrapping the raw collateral into a ButtonToken first

### `borrow(uint256 amount, contract IBondController bond, contract IERC20 currency, uint256[] sales, uint256 minOutput) → uint256 amountOut` (external)

Borrow against a given bond

### `borrowMax(uint256 amount, contract IBondController bond, contract IERC20 currency, uint256 minOutput) → uint256 amountOut` (external)

Borrow as much as possible against a given bond
