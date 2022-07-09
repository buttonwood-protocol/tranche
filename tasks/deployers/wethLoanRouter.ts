import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

task("verify:WethLoanRouter", "Verifies on etherscan")
  .addParam("address", "the contract address", undefined, types.string, false)
  .addParam("loanrouter", "the loanRouter address", undefined, types.string, false)
  .addParam("weth", "the weth address", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { address, loanrouter, weth } = args;

    await hre.run("verify:verify", {
      address,
      constructorArguments: [loanrouter, weth],
    });
  });
