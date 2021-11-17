// import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import { deploy } from "./utils/contracts";

import { BondConfigVault, MockERC20 } from "../typechain";
import { expect } from "chai";

interface TestContext {
  accounts: Signer[];
  deployer: Signer;
  userA: Signer;
  bondConfigVault: BondConfigVault;
  mockUnderlyingToken: MockERC20;
}

describe("BondConfigVault", () => {
  const setupTestContext = async (): Promise<TestContext> => {
    const accounts: Signer[] = await ethers.getSigners();
    const [deployer, userA] = accounts;

    const mockUnderlyingToken: MockERC20 = <MockERC20>await deploy("MockERC20", deployer, ["Mock ERC20", "MOCK"]);
    const bondConfigVault: BondConfigVault = <BondConfigVault>await deploy("BondConfigVault", deployer, []);

    return {
      accounts,
      deployer,
      userA,
      bondConfigVault,
      mockUnderlyingToken,
    };
  };

  describe("Initialization", function () {
    it("Can successfully deploy BondConfigVault with proper arguments", async () => {
      const { bondConfigVault } = await setupTestContext();
      expect(await bondConfigVault.numConfigs()).to.eq(0);
      await expect(bondConfigVault.bondConfigAt(0)).to.be.reverted;
    });
  });

  describe("Ownership", function () {
    it("Can transfer ownership", async () => {
      const { bondConfigVault, deployer, userA } = await setupTestContext();
      const deployerAddress = await deployer.getAddress();
      const userAAddress = await userA.getAddress();

      expect(await bondConfigVault.owner()).to.eq(deployerAddress);
      await bondConfigVault.transferOwnership(userAAddress);
      expect(await bondConfigVault.owner()).to.eq(userAAddress);
    });
  });

  describe("Simple Updating Configs", function () {
    it("Can successfully add a config", async () => {
      const { bondConfigVault, mockUnderlyingToken } = await setupTestContext();

      await expect(bondConfigVault.addBondConfig(mockUnderlyingToken.address, [100, 200, 700], 100))
        .to.emit(bondConfigVault, "BondConfigAdded")
        .withArgs(mockUnderlyingToken.address, [100, 200, 700], 100);

      expect(await bondConfigVault.numConfigs()).to.eq(1);
      const { collateralToken, trancheRatios, duration } = await bondConfigVault.bondConfigAt(0);
      expect(collateralToken).to.eq(mockUnderlyingToken.address);
      // ToDo: Figure out cleaner way to test this
      expect(trancheRatios.toString()).to.eq(
        [BigNumber.from(100), BigNumber.from(200), BigNumber.from(700)].toString(),
      );
      expect(duration).to.eq(100);
    });

    it("Can successfully remove a config", async () => {
      const { bondConfigVault, mockUnderlyingToken } = await setupTestContext();

      // Adding a config first (so that we can test removing it)
      await expect(bondConfigVault.addBondConfig(mockUnderlyingToken.address, [100, 200, 700], 100))
        .to.emit(bondConfigVault, "BondConfigAdded")
        .withArgs(mockUnderlyingToken.address, [100, 200, 700], 100);
      expect(await bondConfigVault.numConfigs()).to.eq(1);

      await expect(bondConfigVault.removeBondConfig(mockUnderlyingToken.address, [100, 200, 700], 100))
        .to.emit(bondConfigVault, "BondConfigRemoved")
        .withArgs(mockUnderlyingToken.address, [100, 200, 700], 100);

      expect(await bondConfigVault.numConfigs()).to.eq(0);
    });
  });

  describe("Updating Configs Edge Cases", function () {
    it("Adding the same config multiple times doesn't change number of configs", async () => {
      const { bondConfigVault, mockUnderlyingToken } = await setupTestContext();

      // Emits the first time
      await expect(bondConfigVault.addBondConfig(mockUnderlyingToken.address, [100, 200, 700], 100))
        .to.emit(bondConfigVault, "BondConfigAdded")
        .withArgs(mockUnderlyingToken.address, [100, 200, 700], 100);

      // Doesn't emit subsequent times.
      for (let i = 0; i < 10; i++) {
        await expect(bondConfigVault.addBondConfig(mockUnderlyingToken.address, [100, 200, 700], 100)).to.not.emit(
          bondConfigVault,
          "BondConfigAdded",
        );
      }

      expect(await bondConfigVault.numConfigs()).to.eq(1);
    });

    it("Removing non-existent config throws error", async () => {
      const { bondConfigVault, mockUnderlyingToken } = await setupTestContext();

      await expect(bondConfigVault.addBondConfig(mockUnderlyingToken.address, [100, 900], 100))
        .to.emit(bondConfigVault, "BondConfigAdded")
        .withArgs(mockUnderlyingToken.address, [100, 900], 100);
      expect(await bondConfigVault.numConfigs()).to.eq(1);

      // Removing non-existent bondConfig to test numConfigs not changing. Shouldn't emit
      await expect(bondConfigVault.removeBondConfig(mockUnderlyingToken.address, [200, 800], 200)).to.not.emit(
        bondConfigVault,
        "BondConfigRemoved",
      );

      // Testing only 1 config present
      expect(await bondConfigVault.numConfigs()).to.eq(1);

      // Validating the 1 config present is the first one, not the latter
      const { collateralToken, trancheRatios, duration } = await bondConfigVault.bondConfigAt(0);
      expect(collateralToken).to.eq(mockUnderlyingToken.address);
      // ToDo: Figure out cleaner way to test this
      expect(trancheRatios.toString()).to.eq([BigNumber.from(100), BigNumber.from(900)].toString());
      expect(duration).to.eq(100);
    });
  });
});
