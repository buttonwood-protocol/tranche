import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

const UNISWAP_V2_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
const UNISWAP_V3_ROUTER = "0xe592427a0aece92de3edee1f18e0157c05861564";

task("deploy:Routers").setAction(async function (_args: TaskArguments, hre) {
  console.log("Signer", await (await hre.ethers.getSigners())[0].getAddress());
  const UniV3LoanRouter = await hre.ethers.getContractFactory("UniV3LoanRouter");
  const uniV3LoanRouter = await UniV3LoanRouter.deploy(UNISWAP_V3_ROUTER);
  await uniV3LoanRouter.deployed();

  console.log("UniswapV3 Router deployed to: ", uniV3LoanRouter.address);

  const UniV2LoanRouter = await hre.ethers.getContractFactory("UniV2LoanRouter");
  const uniV2LoanRouter = await UniV2LoanRouter.deploy(UNISWAP_V2_ROUTER);
  await uniV2LoanRouter.deployed();

  console.log("UniswapV2 Router deployed to: ", uniV2LoanRouter.address);

  try {
    await hre.run("verify:UniLoanRouter", { address: uniV3LoanRouter.address, swapRouter: UNISWAP_V3_ROUTER });
    await hre.run("verify:UniLoanRouter", { address: uniV3LoanRouter.address, swapRouter: UNISWAP_V2_ROUTER });
  } catch (e) {
    console.log("Unable to verify on etherscan", e);
  }
});

task("verify:UniLoanRouter", "Verifies on etherscan")
  .addParam("address", "the contract address", undefined, types.string, false)
  .addParam("swapRouter", "the uniswap router address", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { address, swapRouter } = args;

    await hre.run("verify:verify", {
      address,
      constructorArguments: [swapRouter],
    });
  });
