## `WethLoanRouter`

Weth Loan Router built on top of a LoanRouter of your choosing
to allow loans to be created with raw ETH instead of WETH

### `constructor(contract ILoanRouter _loanRouter, contract IWETH9 _weth)` (public)

Constructor for setting underlying loanRouter and weth contracts

### `wrapAndBorrow(contract IBondController bond, contract IERC20 currency, uint256[] sales, uint256 minOutput) → uint256 amountOut` (external)

Borrow against a given bond, wrapping the raw ETH collateral into a WETH ButtonToken first

### `wrapAndBorrowMax(contract IBondController bond, contract IERC20 currency, uint256 minOutput) → uint256 amountOut` (external)

Borrow as much as possible against a given bond,
wrapping the raw ETH collateral into a WETH ButtonToken first

### `_wethWrapAndApprove() → uint256` (internal)

Wraps the ETH that was transferred to this contract and then approves loanRouter for entire amount
No need to check that bond's collateral has WETH as underlying since deposit will fail otherwise

### `_distributeLoanOutput(uint256 amountOut, contract IBondController bond, contract IERC20 currency)` (internal)

Distributes tranche balances and borrowed amounts to end-user
