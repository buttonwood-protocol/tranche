## `LoanRouter`

Abstract Loan Router to allow loans to be created with different AMM implementations
Loans are created using a composition of ButtonTranche and an AMM for Tranche token liquidity
vs. a stablecoin. The specific AMM that we use may change, so concrete implementations
of this abstract contract can define a `swap` function to implement a composition with
the AMM of their choosing.

### `wrapAndBorrow(uint256 underlyingAmount, contract IBondController bond, contract IERC20 currency, uint256[] sales, uint256 minOutput) → uint256 amountOut` (external)

Borrow against a given bond, wrapping the raw collateral into a ButtonToken first

### `wrapAndBorrowMax(uint256 underlyingAmount, contract IBondController bond, contract IERC20 currency, uint256 minOutput) → uint256 amountOut` (external)

Borrow as much as possible against a given bond, wrapping the raw collateral into a ButtonToken first

### `borrow(uint256 amount, contract IBondController bond, contract IERC20 currency, uint256[] sales, uint256 minOutput) → uint256 amountOut` (external)

Borrow against a given bond

### `borrowMax(uint256 amount, contract IBondController bond, contract IERC20 currency, uint256 minOutput) → uint256 amountOut` (external)

Borrow as much as possible against a given bond

### `_borrow(uint256 amount, contract IBondController bond, contract IERC20 collateral, contract IERC20 currency, uint256[] sales, uint256 minOutput) → uint256 amountOut` (internal)

Internal function to borrow a given currency from a given collateral

### `_swap(address input, address output, uint256 amount)` (internal)

Virtual function to define the swapping mechanism for a loan router
