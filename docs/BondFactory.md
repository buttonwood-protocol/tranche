## `BondFactory`

Factory for BondController minimal proxy contracts

### `constructor(address _target, address _trancheFactory)` (public)

### `createBond(address _collateralToken, uint256[] trancheRatios, uint256 maturityDate) → address` (external)

Deploys a minimal proxy instance for a new bond with the given parameters.
