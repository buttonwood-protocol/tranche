## `IBondController`

Controller for a ButtonTranche bond system

### `collateralToken() → address` (external)

### `tranches(uint256 i) → contract ITranche token, uint256 ratio` (external)

### `trancheCount() → uint256 count` (external)

### `feeBps() → uint256 fee` (external)

### `maturityDate() → uint256 maturityDate` (external)

### `isMature() → bool isMature` (external)

### `creationDate() → uint256 creationDate` (external)

### `totalDebt() → uint256 totalDebt` (external)

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

### `Deposit(address from, uint256 amount, uint256 feeBps)`

### `Mature(address caller)`

### `RedeemMature(address user, address tranche, uint256 amount)`

### `Redeem(address user, uint256[] amounts)`

### `FeeUpdate(uint256 newFee)`
