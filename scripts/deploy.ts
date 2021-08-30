import { ethers } from "hardhat";

async function main(): Promise<void> {
  const BondController = await ethers.getContractFactory("BondController");
  const bondController = await BondController.deploy();
  await bondController.deployed();
  console.log("Bond controller implementation", bondController.address);

  const Tranche = await ethers.getContractFactory("Tranche");
  const tranche = await Tranche.deploy();
  await tranche.deployed();
  console.log("Tranche implementation", tranche.address);

  const TrancheFactory = await ethers.getContractFactory("TrancheFactory");
  const trancheFactory = await TrancheFactory.deploy(tranche.address);
  await trancheFactory.deployed();
  console.log("Tranche Factory", trancheFactory.address);

  const BondFactory = await ethers.getContractFactory("BondFactory");
  const bondFactory = await BondFactory.deploy(bondController.address, trancheFactory.address);
  await bondFactory.deployed();
  console.log("Bond Factory", bondFactory.address);

  const Router = await ethers.getContractFactory("UniV3LoanRouter");
  const router = await Router.deploy("0xe592427a0aece92de3edee1f18e0157c05861564");
  await router.deployed();

  console.log("Router deployed to: ", router.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
