import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

task("deposit")
  .addParam("address", "the contract address", undefined, types.string, false)
  .addParam("amount", "the amount to deposit", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    console.log("Signer", await (await hre.ethers.getSigners())[0].getAddress());

    const { address, amount } = args;

    const bond = await hre.ethers.getContractAt("BondController", address);

    console.log("Bond address: ", bond.address);

    const collateralAddress = await bond.collateralToken();
    const collateral = await hre.ethers.getContractAt("contracts/external/ERC20.sol:ERC20", collateralAddress);

    await collateral.approve(address, amount);

    // Fails on deposit on first attempt
    // Succeeds on 2nd attempt for unknown reasons
    await bond.deposit(amount);
  });
