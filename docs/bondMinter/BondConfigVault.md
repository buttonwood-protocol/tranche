## `BondConfigVault`

Implementation of IBondConfigVault




### `addBondConfig(address collateralToken_, uint256[] trancheRatios_, uint256 duration_)` (external)

Adds new bond configuration to internal list


Stores a hash of the bondConfig into `configHashes` and a corresponding entry into `bondConfigMapping`

### `removeBondConfig(address collateralToken_, uint256[] trancheRatios_, uint256 duration_)` (external)

Removes bond configuration to internal list


Removes the hash of the bondConfig from `configHashes` and the corresponding entry from `bondConfigMapping`

### `numConfigs() → uint256` (public)

The number of configs stored in the vault

Retrieves the length of `configHashes`

### `bondConfigAt(uint256 index) → struct IBondConfigVault.BondConfig` (public)

Returns the bondConfig stored at `index`

No guarantees are made on the ordering.
Retrieves the hash at `index` and returns corresponding value from `bondConfigMapping`




