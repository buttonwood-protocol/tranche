import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { Contract } from "ethers";
import UniswapV3FactoryArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";

const UNISWAP_V3_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

task("deploy:Pool")
  .addParam("token0", "the first token address", undefined, types.string, false)
  .addParam("token1", "the second token address", undefined, types.string, false)
  .addParam("fee", "the pool fee", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const signer = (await hre.ethers.getSigners())[0];
    console.log("signer", await signer.getAddress());
    const { token0, token1, fee } = args;
    const Factory = new Contract(UNISWAP_V3_ADDRESS, UniswapV3FactoryArtifact.abi, signer);
    const tx = await Factory.createPool(token0, token1, fee);
    const receipt = await tx.wait();
    const poolAddress = receipt.events[0].args.pool;
    console.log(`pool ${poolAddress} created for ${token0} and ${token1}`);
    return poolAddress;
  });
