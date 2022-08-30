import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

task("deploy:WethLoanRouter")
  .addParam("loanRouter", "the loanRouter address", undefined, types.string, false)
  .addParam("weth", "the weth address", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { loanRouter, weth } = args;

    console.log("Signer", await (await hre.ethers.getSigners())[0].getAddress());
    const WethLoanRouter = await hre.ethers.getContractFactory("WethLoanRouter");
    const wethLoanRouter = await WethLoanRouter.deploy(loanRouter, weth);
    await wethLoanRouter.deployed();
    console.log("Weth Loan Router implementation", wethLoanRouter.address);

    try {
      await hre.run("verify:WethLoanRouter", {
        address: wethLoanRouter.address,
        loanRouter,
        weth,
      });
    } catch (e) {
      console.log("Unable to verify on etherscan", e);
    }
  });

task("verify:WethLoanRouter", "Verifies on etherscan")
  .addParam("address", "the contract address", undefined, types.string, false)
  .addParam("loanRouter", "the loanRouter address", undefined, types.string, false)
  .addParam("weth", "the weth address", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { address, loanRouter, weth } = args;

    await hre.run("verify:verify", {
      address,
      constructorArguments: [loanRouter, weth],
    });
  });
