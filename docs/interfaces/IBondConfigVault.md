## `IBondConfigVault`

Interface for storing BondConfigs

### `addBondConfig(address collateralToken, uint256[] trancheRatios, uint256 duration)` (external)

Adds new bond configuration to internal list

### `removeBondConfig(address collateralToken, uint256[] trancheRatios, uint256 duration)` (external)

Removes bond configuration to internal list

### `numConfigs() → uint256` (external)

The number of configs stored in the vault

### `bondConfigAt(uint256 index) → struct IBondConfigVault.BondConfig` (external)

Returns the bondConfig stored at `index`

### `BondConfigAdded(address collateralToken, uint256[] trancheRatios, uint256 duration)`

Event emitted when a new BondConfig is added

### `BondConfigRemoved(address collateralToken, uint256[] trancheRatios, uint256 duration)`

Event emitted when a BondConfig is removed

### `BondConfig`

address collateralToken

uint256[] trancheRatios

uint256 duration
