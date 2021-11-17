## `BondMinter`

Implementation of IBondMinter

### `constructor(contract IBondFactory _bondFactory, uint256 _waitingPeriod)` (public)

Constructor for IBondMinter

### `setBondFactory(contract IBondFactory _bondFactory)` (external)

Sets the bondFactory

Only the contract owner can call this method

### `setWaitingPeriod(uint256 _waitingPeriod)` (external)

Sets the waitingPeriod required between minting periods

Only the contract owner can call this

### `mintBonds()` (external)

Iterates over configurations and mints bonds for each using the bondFactory

Requires that enough time has passed since last minting. Uses block timestamp to calculate this.
