import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

task("verify:WamplLoanRouter", "Verifies on etherscan")
  .addParam("address", "the contract address", undefined, types.string, false)
  .addParam("loanrouter", "the loanRouter address", undefined, types.string, false)
  .addParam("wampl", "the wampl address", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { address, loanrouter, wampl } = args;

    await hre.run("verify:verify", {
      address,
      constructorArguments: [loanrouter, wampl],
    });
  });
