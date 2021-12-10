import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

const DUMMY_ADDRESS = "0x000000000000000000000000000000000000dead";

task("deploy:BondFactory").setAction(async function (_args: TaskArguments, hre) {
  console.log("Signer", await (await hre.ethers.getSigners())[0].getAddress());
  const BondController = await hre.ethers.getContractFactory("BondController");
  const bondController = await BondController.deploy();
  await bondController.deployed();
  console.log("Bond controller implementation", bondController.address);

  const Tranche = await hre.ethers.getContractFactory("Tranche");
  const tranche = await Tranche.deploy();
  await tranche.deployed();
  console.log("Tranche implementation", tranche.address);

  const TrancheFactory = await hre.ethers.getContractFactory("TrancheFactory");
  const trancheFactory = await TrancheFactory.deploy(tranche.address);
  await trancheFactory.deployed();
  console.log("Tranche Factory", trancheFactory.address);

  await tranche["init(string,string,address,address)"]("IMPLEMENTATION", "IMPL", DUMMY_ADDRESS, DUMMY_ADDRESS);
  await bondController.init(
    trancheFactory.address,
    tranche.address,
    DUMMY_ADDRESS,
    [200, 300, 500],
    hre.ethers.constants.MaxUint256,
    0,
  );

  const BondFactory = await hre.ethers.getContractFactory("BondFactory");
  const bondFactory = await BondFactory.deploy(bondController.address, trancheFactory.address);
  await bondFactory.deployed();
  console.log("Bond Factory", bondFactory.address);

  try {
    await hre.run("verify:Template", { address: bondController.address });
    await hre.run("verify:Template", { address: tranche.address });
    await hre.run("verify:TrancheFactory", {
      address: trancheFactory.address,
      template: tranche.address,
    });
    await hre.run("verify:BondFactory", {
      address: bondFactory.address,
      template: bondController.address,
      trancheFactory: trancheFactory.address,
    });
  } catch (e) {
    console.log("Unable to verify on etherscan", e);
  }
});

task("verify:Template", "Verifies on etherscan")
  .addParam("address", "the contract address", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { address } = args;

    await hre.run("verify:verify", {
      address,
    });
  });

task("verify:TrancheFactory", "Verifies on etherscan")
  .addParam("address", "the contract address", undefined, types.string, false)
  .addParam("template", "the template address", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { address, template } = args;

    await hre.run("verify:verify", {
      address,
      constructorArguments: [template],
    });
  });

task("verify:BondFactory", "Verifies on etherscan")
  .addParam("address", "the contract address", undefined, types.string, false)
  .addParam("template", "the template address", undefined, types.string, false)
  .addParam("trancheFactory", "the tranche factory address", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { address, template, trancheFactory } = args;

    await hre.run("verify:verify", {
      address,
      constructorArguments: [template, trancheFactory],
    });
  });
