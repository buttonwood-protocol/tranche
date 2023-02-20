## `IRebasingERC20`

### `scaledBalanceOf(address who) → uint256` (external)

Returns the fixed balance of the specified address.

### `scaledTotalSupply() → uint256` (external)

Returns the total fixed supply.

### `transferAll(address to) → bool` (external)

Transfer all of the sender's balance to a specified address.

### `transferAllFrom(address from, address to) → bool` (external)

Transfer all balance tokens from one address to another.

### `rebase()` (external)

Triggers the next rebase, if applicable.

### `Rebase(uint256 epoch, uint256 newScalar)`

Event emitted when the balance scalar is updated.
