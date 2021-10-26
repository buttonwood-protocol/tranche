// import { expect } from "chai";
import { ethers, waffle, artifacts } from "hardhat";
import { Signer } from "ethers";
import { deploy } from "./utils/contracts";
import { BondMinter, MockERC20 } from "../contracts/typechain";
import { expect } from "chai";
import { MockContract } from "ethereum-waffle";

const DAYS_29: number = 29 * 24 * 60 * 60;
const DAYS_30: number = 30 * 24 * 60 * 60;
const DAYS_60: number = 60 * 24 * 60 * 60;

interface TestContext {
  accounts: Signer[];
  deployer: Signer;
  userA: Signer;
  bondMinter: BondMinter;
  mockBondFactory: MockContract;
  mockUnderlyingToken: MockERC20;
}

describe("BondConfigVault", () => {
  const setupTestContext = async (): Promise<TestContext> => {
    const accounts: Signer[] = await ethers.getSigners();
    const [deployer, userA] = accounts;

    const bondFactory = await artifacts.readArtifact("BondFactory");
    const abi = bondFactory.abi;

    const mockBondFactory: MockContract = await waffle.deployMockContract(deployer, abi);
    const bondMinter: BondMinter = <BondMinter>await deploy("BondMinter", deployer, [mockBondFactory.address, DAYS_30]);

    const mockUnderlyingToken: MockERC20 = <MockERC20>await deploy("MockERC20", deployer, ["Mock ERC20", "MOCK"]);

    return {
      accounts,
      deployer,
      userA,
      bondMinter,
      mockBondFactory,
      mockUnderlyingToken,
    };
  };

  describe("Initialization", function () {
    it("Can successfully deploy BondConfigVault with proper arguments", async () => {
      const { bondMinter, mockBondFactory } = await setupTestContext();
      expect(await bondMinter.numConfigs()).to.eq(0);
      await expect(bondMinter.bondConfigAt(0)).to.be.reverted;
      expect(await bondMinter.bondFactory()).to.eq(mockBondFactory.address);
      expect(await bondMinter.waitingPeriod()).to.eq(DAYS_30);
    });
  });

  describe("State Updates", function () {
    it("Updating Waiting Period", async () => {
      const { bondMinter } = await setupTestContext();

      expect(await bondMinter.waitingPeriod()).to.eq(DAYS_30);
      await bondMinter.setWaitingPeriod(DAYS_60);
      expect(await bondMinter.waitingPeriod()).to.eq(DAYS_60);
    });
  });

  describe("Bond Minting", function () {
    it("Adding 2 bonds and minting them", async () => {
      const { bondMinter, mockBondFactory, mockUnderlyingToken } = await setupTestContext();

      await expect(bondMinter.addBondConfig(mockUnderlyingToken.address, [100, 200, 700], 100));
      await expect(bondMinter.addBondConfig(mockUnderlyingToken.address, [200, 300, 500], 300));

      const blockNumBefore = await ethers.provider.getBlockNumber();
      const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      const timestampBefore = blockBefore.timestamp;
      const timestampAfter = timestampBefore + 999;

      await mockBondFactory.mock.createBond
        .withArgs(mockUnderlyingToken.address, [100, 200, 700], timestampAfter + 100)
        .returns("0x0000000000000000000000000000000000000001");

      await mockBondFactory.mock.createBond
        .withArgs(mockUnderlyingToken.address, [200, 300, 500], timestampAfter + 300)
        .returns("0x0000000000000000000000000000000000000002");

      await ethers.provider.send("evm_setNextBlockTimestamp", [timestampAfter]);

      await bondMinter.mintBonds();
    });

    it("Minting same bond twice after waiting the exact waiting period", async () => {
      const { bondMinter, mockBondFactory, mockUnderlyingToken } = await setupTestContext();

      await expect(bondMinter.addBondConfig(mockUnderlyingToken.address, [100, 200, 700], 100));

      const blockNumBefore = await ethers.provider.getBlockNumber();
      const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      const timestampBefore = blockBefore.timestamp;
      const timestampAfter = timestampBefore + 999;

      await mockBondFactory.mock.createBond
        .withArgs(mockUnderlyingToken.address, [100, 200, 700], timestampAfter + 100)
        .returns("0x0000000000000000000000000000000000000001");

      await ethers.provider.send("evm_setNextBlockTimestamp", [timestampAfter]);

      await bondMinter.mintBonds();

      await mockBondFactory.mock.createBond
        .withArgs(mockUnderlyingToken.address, [100, 200, 700], timestampAfter + DAYS_30 + 100)
        .returns("0x0000000000000000000000000000000000000002");

      await ethers.provider.send("evm_setNextBlockTimestamp", [timestampAfter + DAYS_30]);

      await bondMinter.mintBonds();
    });

    it("Minting same bond twice too soon should revert", async () => {
      const { bondMinter, mockBondFactory, mockUnderlyingToken } = await setupTestContext();

      await expect(bondMinter.addBondConfig(mockUnderlyingToken.address, [100, 200, 700], 100));

      const blockNumBefore = await ethers.provider.getBlockNumber();
      const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      const timestampBefore = blockBefore.timestamp;
      const timestampAfter = timestampBefore + 999;

      await mockBondFactory.mock.createBond
        .withArgs(mockUnderlyingToken.address, [100, 200, 700], timestampAfter + 100)
        .returns("0x0000000000000000000000000000000000000001");

      await ethers.provider.send("evm_setNextBlockTimestamp", [timestampAfter]);

      await bondMinter.mintBonds();

      await mockBondFactory.mock.createBond
        .withArgs(mockUnderlyingToken.address, [100, 200, 700], timestampAfter + DAYS_29 + 100)
        .returns("0x0000000000000000000000000000000000000002");

      await ethers.provider.send("evm_setNextBlockTimestamp", [timestampAfter + DAYS_29]);

      await expect(bondMinter.mintBonds()).to.be.reverted;
    });
  });
});
