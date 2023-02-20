## `IWamplLoanRouter`

Router for creating loans with tranche

### `wrapAndBorrow(uint256 amplAmount, contract IBondController bond, contract IERC20 currency, uint256[] sales, uint256 minOutput) → uint256 amountOut` (external)

Borrow against a given bond, wrapping the raw AMPL collateral into a WAMPL ButtonToken first

### `wrapAndBorrowMax(uint256 amplAmount, contract IBondController bond, contract IERC20 currency, uint256 minOutput) → uint256 amountOut` (external)

Borrow as much as possible against a given bond,
wrapping the raw ampl collateral into a WAMPL ButtonToken first
