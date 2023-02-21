## `BondController`

Controller for a ButtonTranche bond

Invariants:

- `totalDebt` should always equal the sum of all tranche tokens' `totalSupply()`

### `onSkim()`

Skims extraneous collateral that was incorrectly sent to the contract

### `init(address _trancheFactory, address _collateralToken, address _admin, uint256[] trancheRatios, uint256 _maturityDate, uint256 _depositLimit)` (external)

Constructor for Tranche ERC20 token

### `deposit(uint256 amount)` (external)

Deposit `amount` tokens from `msg.sender`, get tranche tokens in return
Requirements:

- `msg.sender` must have `approved` `amount` collateral tokens to this contract

### `mature()` (external)

Matures the bond. Disables deposits,
fixes the redemption ratio, and distributes collateral to redemption pools
Redeems any fees collected from deposits, sending redeemed funds to the contract owner
Requirements:

- The bond is not already mature
- One of:
  - `msg.sender` is owner
  - `maturityDate` has passed

### `redeemMature(address tranche, uint256 amount)` (external)

Redeems some tranche tokens
Requirements:

- The bond is mature
- `msg.sender` owns at least `amount` tranche tokens from address `tranche`
- `tranche` must be a valid tranche token on this bond

### `redeem(uint256[] amounts)` (external)

Redeems a slice of tranche tokens from all tranches.
Returns collateral to the user proportionally to the amount of debt they are removing
Requirements

- The bond is not mature
- The number of `amounts` is the same as the number of tranches
- The `amounts` are in equivalent ratio to the tranche order

### `setFee(uint256 newFeeBps)` (external)

Updates the fee taken on deposit to the given new fee

Requirements

- `msg.sender` has admin role
- `newFeeBps` is in range [0, 50]

### `getTrancheName(string collateralSymbol, uint256 index, uint256 _trancheCount) → string` (internal)

Get the string name for a tranche

### `getTrancheSymbol(string collateralSymbol, uint256 index, uint256 _trancheCount) → string` (internal)

Get the string symbol for a tranche

### `getTrancheLetter(uint256 index, uint256 _trancheCount) → string` (internal)

Get the string letter for a tranche index

### `_enforceTotalDebt()` (internal)

### `collateralBalance() → uint256` (external)

Get the virtual collateral balance of the bond
