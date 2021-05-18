## `IBondController`

Controller for a ButtonTranche bond system

### `deposit(uint256 amount)` (external)

Deposit `amount` tokens from `msg.sender`, get tranche tokens in return
Requirements:

- `msg.sender` must have `approved` `amount` collateral tokens to this contract

### `mature()` (external)

Matures the bond. Disables deposits,
fixes the redemption ratio, and distributes collateral to redemption pools
Requirements:

- The bond is not already mature
- One of:
  - `msg.sender` is `owner`
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

### `Deposit(address from, uint256 amount)`

### `Mature(address caller)`

### `RedeemMature(address user, address tranche, uint256 amount)`

### `Redeem(address user, uint256[] amounts)`
