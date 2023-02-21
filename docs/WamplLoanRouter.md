## `WamplLoanRouter`

Wampl Loan Router built on top of a LoanRouter of your choosing
to allow loans to be created with raw ampl instead of WAMPL

### `constructor(contract ILoanRouter _loanRouter, contract IWAMPL _wampl)` (public)

Constructor for setting underlying loanRouter and wampl contracts

### `wrapAndBorrow(uint256 amplAmount, contract IBondController bond, contract IERC20 currency, uint256[] sales, uint256 minOutput) → uint256 amountOut` (external)

Borrow against a given bond, wrapping the raw AMPL collateral into a WAMPL ButtonToken first

### `wrapAndBorrowMax(uint256 amplAmount, contract IBondController bond, contract IERC20 currency, uint256 minOutput) → uint256 amountOut` (external)

Borrow as much as possible against a given bond,
wrapping the raw ampl collateral into a WAMPL ButtonToken first

### `_wamplWrapAndApprove(uint256 amplAmount) → uint256` (internal)

Wraps the AMPL that was transferred to this contract and then approves loanRouter for entire amount
No need to check that bond's collateral has WAMPL as underlying since deposit will fail otherwise

### `_distributeLoanOutput(uint256 amountOut, contract IBondController bond, contract IERC20 currency)` (internal)

Distributes tranche balances and borrowed amounts to end-user
