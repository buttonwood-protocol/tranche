import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { Contract, Signer } from "ethers";
import { CurrencyAmount, Price, Token } from "@uniswap/sdk-core";
import { encodeSqrtRatioX96, priceToClosestTick } from "@uniswap/v3-sdk";
import UniswapV3PoolArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import UniswapPositionManagerArtifact from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import SwapRouterArtifact from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";

// NOTE: this task is only meant to be run on testnet

const KOVAN_WEENUS = "0xaFF4481D10270F50f203E0763e2597776068CBc5";
const NONFUNGIBLE_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const SWAP_ROUTER = "0xe592427a0aece92de3edee1f18e0157c05861564";
// always true for 1% pools
const TICK_SPACING = 200;

interface PoolData {
  token0: Token;
  token1: Token;
  address: string;
}

task("setup:Bond")
  .addParam("factory", "The bond factory address", undefined, types.string, false)
  .addParam("collateral", "the collateral token address", undefined, types.string, false)
  .addParam("maturity", "the collateral token address", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { collateral } = args;
    const network = hre.network.config;
    if (network.chainId !== 42) {
      throw new Error("Setup task only valid on Kovan");
    }
    const signer = (await hre.ethers.getSigners())[0];
    console.log(`Signer: ${await signer.getAddress()}`);

    const collateralToken = await hre.ethers.getContractAt("MockERC20", collateral);
    const depositAmount = hre.ethers.utils.parseUnits("10000", await collateralToken.decimals());
    const balance = await collateralToken.balanceOf(await signer.getAddress());
    if (balance.lt(depositAmount)) {
      throw new Error(`Not enough balance of ${collateral}. Have: ${balance.toString()}, need: ${depositAmount}`);
    }

    const bondAddress = await hre.run("deploy:Bond", args);
    const bond = await hre.ethers.getContractAt("BondController", bondAddress);
    const aTranche = (await bond.tranches(0)).token;
    const bTranche = (await bond.tranches(1)).token;

    // deposit to get some tranche tokens to init the pool
    console.log(`Approving and depositing ${depositAmount} collateral into bond`);
    await collateralToken.approve(bond.address, depositAmount);
    await bond.deposit(depositAmount);
    console.log("Minting 2000 weenus");
    await signer.sendTransaction({ to: KOVAN_WEENUS });
    await signer.sendTransaction({ to: KOVAN_WEENUS });

    console.log("Deploying pools for A and B tranches");
    const aPool = await hre.run("deploy:Pool", { token0: aTranche, token1: KOVAN_WEENUS, fee: "10000" });
    const bPool = await hre.run("deploy:Pool", { token0: bTranche, token1: KOVAN_WEENUS, fee: "10000" });

    const aPoolData = await getPoolData(aPool, signer, hre);
    await addLiquidity(aPoolData, signer, hre);
    await initialSwap(aPoolData, signer, hre);
    const bPoolData = await getPoolData(bPool, signer, hre);
    await addLiquidity(bPoolData, signer, hre);
    await initialSwap(bPoolData, signer, hre);
  });

async function addLiquidity(poolData: PoolData, signer: Signer, hre: HardhatRuntimeEnvironment): Promise<void> {
  const { token0, token1, address: poolAddress } = poolData;
  const pool = new Contract(poolAddress, UniswapV3PoolArtifact.abi, signer);
  const token0Token = await hre.ethers.getContractAt("MockERC20", token0.address);
  const token1Token = await hre.ethers.getContractAt("MockERC20", token1.address);

  const weenus = token0.address.toLowerCase() === KOVAN_WEENUS.toLowerCase() ? token0 : token1;
  const tranche = token0.address.toLowerCase() === KOVAN_WEENUS.toLowerCase() ? token1 : token0;

  const highPrice = new Price({
    baseAmount: CurrencyAmount.fromRawAmount(weenus, hre.ethers.utils.parseUnits("70", weenus.decimals).toString()),
    quoteAmount: CurrencyAmount.fromRawAmount(tranche, hre.ethers.utils.parseUnits("100", tranche.decimals).toString()),
  });
  const highTick = priceToClosestTick(highPrice) - (priceToClosestTick(highPrice) % TICK_SPACING);

  const currentPrice = new Price({
    baseAmount: CurrencyAmount.fromRawAmount(weenus, hre.ethers.utils.parseUnits("80", weenus.decimals).toString()),
    quoteAmount: CurrencyAmount.fromRawAmount(tranche, hre.ethers.utils.parseUnits("100", tranche.decimals).toString()),
  });

  const lowPrice = new Price({
    baseAmount: CurrencyAmount.fromRawAmount(weenus, hre.ethers.utils.parseUnits("90", weenus.decimals).toString()),
    quoteAmount: CurrencyAmount.fromRawAmount(tranche, hre.ethers.utils.parseUnits("100", tranche.decimals).toString()),
  });

  const lowTick = priceToClosestTick(lowPrice) - (priceToClosestTick(lowPrice) % TICK_SPACING);
  const sqrtRatio = encodeSqrtRatioX96(currentPrice.numerator, currentPrice.denominator);
  console.log("Initializing pool");
  await pool.initialize(sqrtRatio.toString());

  const mintParams = {
    token0: token0.address,
    token1: token1.address,
    fee: "10000",
    // switches depending on token ordering
    tickLower: lowTick > highTick ? highTick : lowTick,
    tickUpper: lowTick > highTick ? lowTick : highTick,
    amount0Desired: hre.ethers.utils.parseUnits("1000", token0.decimals),
    amount1Desired: hre.ethers.utils.parseUnits("1000", token1.decimals),
    amount0Min: 0,
    amount1Min: 0,
    recipient: await signer.getAddress(),
    deadline: Math.floor((new Date().getTime() + 86400) / 1000),
  };
  console.log("Approving tokens to the NFT manager");
  await token0Token.approve(NONFUNGIBLE_POSITION_MANAGER, hre.ethers.constants.MaxUint256);
  await token1Token.approve(NONFUNGIBLE_POSITION_MANAGER, hre.ethers.constants.MaxUint256);
  const manager = new Contract(NONFUNGIBLE_POSITION_MANAGER, UniswapPositionManagerArtifact.abi, signer);

  console.log("Adding liquidity");
  return await manager.mint(mintParams);
}

async function initialSwap(poolData: PoolData, signer: Signer, hre: HardhatRuntimeEnvironment): Promise<void> {
  const { token0, token1, address: poolAddress } = poolData;
  const weenus = token0.address.toLowerCase() === KOVAN_WEENUS.toLowerCase() ? token0 : token1;
  const tranche = token0.address.toLowerCase() === KOVAN_WEENUS.toLowerCase() ? token1 : token0;
  const trancheToken = await hre.ethers.getContractAt("MockERC20", tranche.address);
  const weenusToken = await hre.ethers.getContractAt("MockERC20", weenus.address);
  let tokenIn, tokenOut, decimals;
  if ((await trancheToken.balanceOf(poolAddress)).gt(0)) {
    tokenIn = weenusToken;
    tokenOut = trancheToken;
    decimals = weenus.decimals;
  } else {
    tokenIn = trancheToken;
    tokenOut = weenusToken;
    decimals = tranche.decimals;
  }
  const amount = hre.ethers.utils.parseUnits("0.01", decimals);
  console.log(`Approving ${amount} to swap router`);
  await tokenIn.approve(SWAP_ROUTER, amount);

  const swapParams = {
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    fee: 10000,
    recipient: await signer.getAddress(),
    deadline: Math.floor((new Date().getTime() + 86400) / 1000),
    amountIn: amount,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
  };
  const router = new Contract(SWAP_ROUTER, SwapRouterArtifact.abi, signer);
  console.log(`Swapping ${amount}`);
  await router.exactInputSingle(swapParams);
}

async function getPoolData(poolAddress: string, signer: Signer, hre: HardhatRuntimeEnvironment) {
  const pool = new Contract(poolAddress, UniswapV3PoolArtifact.abi, signer);
  const token0Address = await pool.token0();
  const token1Address = await pool.token1();
  const token0Token = await hre.ethers.getContractAt("MockERC20", token0Address);
  const token1Token = await hre.ethers.getContractAt("MockERC20", token1Address);
  const token0Decimals = await token0Token.decimals();
  const token1Decimals = await token1Token.decimals();
  const token0 = new Token(42, token0Address, token0Decimals);
  const token1 = new Token(42, token1Address, token1Decimals);
  return {
    address: poolAddress,
    token0,
    token1,
  };
}
