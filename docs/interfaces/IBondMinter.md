## `IBondMinter`

Interface for canonically minting bonds according to a stored vaults of configurations

### `setBondFactory(contract IBondFactory _bondFactory)` (external)

Sets the bondFactory

### `setWaitingPeriod(uint256 _waitingPeriod)` (external)

Sets the waitingPeriod required between minting periods

### `mintBonds()` (external)

Iterates over configurations and mints bonds for each using the bondFactory

### `isInstance(address bond) → bool` (external)

Checks if a given bond was instantiated by the minter

### `BondMinted(address bond)`

Event emitted when a new bond is minted using this minter
