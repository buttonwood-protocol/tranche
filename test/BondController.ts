import { expect } from "chai";
import hre from "hardhat";
import { Signer } from "ethers";
import { deploy } from "./utils/contracts";

import { BondController, BondFactory, MockERC20, Tranche, TrancheFactory } from "../typechain";

interface TestContext {
  bond: BondController;
  tranches: Tranche[];
  mockCollateralToken: MockERC20;
  user: Signer;
  other: Signer;
  signers: Signer[];
}

describe("Bond Controller", () => {
  /**
   * Sets up a test context, deploying new contracts and returning them for use in a test
   */
  const setupTestContext = async (tranches: number[]): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();

    const trancheImplementation = <Tranche>await deploy("Tranche", signers[0], []);
    const trancheFactory = <TrancheFactory>await deploy("TrancheFactory", signers[0], [trancheImplementation.address]);

    const bondImplementation = <BondController>await deploy("BondController", signers[0], []);
    const bondFactory = <BondFactory>(
      await deploy("BondFactory", signers[0], [bondImplementation.address, trancheFactory.address])
    );

    const mockCollateralToken = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);
    const tx = await bondFactory
      .connect(signers[0])
      .createBond(mockCollateralToken.address, tranches, new Date().getTime() + 10000);
    const receipt = await tx.wait();

    let bond: BondController | undefined;
    if (receipt && receipt.events) {
      for (const event of receipt.events) {
        if (event.args && event.args.newBondAddress) {
          bond = <BondController>await hre.ethers.getContractAt("BondController", event.args.newBondAddress);
        }
      }
    } else {
      throw new Error("Unable to create new bond");
    }
    if (!bond) {
      throw new Error("Unable to create new bond");
    }

    const trancheContracts: Tranche[] = [];
    for (let i = 0; i < tranches.length; i++) {
      const tranche = <Tranche>await hre.ethers.getContractAt("Tranche", (await bond.tranches(i)).token);
      trancheContracts.push(tranche);
    }

    return {
      bond,
      mockCollateralToken,
      tranches: trancheContracts,
      user: signers[0],
      other: signers[1],
      signers: signers.slice(2),
    };
  };

  describe("Initialization", function () {
    it("should successfully initialize a tranche bond", async () => {
      const { bond, tranches, mockCollateralToken, user } = await setupTestContext([100, 200, 200, 500]);
      expect(await bond.collateralToken()).to.equal(mockCollateralToken.address);
      // ensure user has admin permissions
      expect(await bond.hasRole(hre.ethers.constants.HashZero, await user.getAddress())).to.be.true;
      expect(await bond.totalDebt()).to.equal(0);
      expect(await bond.isMature()).to.be.false;
      for (const tranche of tranches) {
        expect(await tranche.collateralToken()).to.equal(mockCollateralToken.address);
        expect(await tranche.hasRole(hre.ethers.constants.HashZero, bond.address)).to.be.true;
      }
    });

    it("should fail if a bond has already been created", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();

      const trancheImplementation = <Tranche>await deploy("Tranche", signers[0], []);
      const trancheFactory = <TrancheFactory>(
        await deploy("TrancheFactory", signers[0], [trancheImplementation.address])
      );

      const bondImplementation = <BondController>await deploy("BondController", signers[0], []);
      const bondFactory = <BondFactory>(
        await deploy("BondFactory", signers[0], [bondImplementation.address, trancheFactory.address])
      );

      const mockCollateralToken = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);
      const maturityDate = new Date().getTime() + 10000;
      await bondFactory.connect(signers[0]).createBond(mockCollateralToken.address, [100, 200, 200, 500], maturityDate);

      await expect(
        bondFactory.connect(signers[0]).createBond(mockCollateralToken.address, [100, 200, 200, 500], maturityDate),
      ).to.be.revertedWith("BondFactory: Bond already exists");
    });

    it("should fail if maturity date is already passed", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();

      const trancheImplementation = <Tranche>await deploy("Tranche", signers[0], []);
      const trancheFactory = <TrancheFactory>(
        await deploy("TrancheFactory", signers[0], [trancheImplementation.address])
      );

      const bondImplementation = <BondController>await deploy("BondController", signers[0], []);
      const bondFactory = <BondFactory>(
        await deploy("BondFactory", signers[0], [bondImplementation.address, trancheFactory.address])
      );

      const mockCollateralToken = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);
      await expect(
        bondFactory
          .connect(signers[0])
          .createBond(mockCollateralToken.address, [500, 500], Math.floor(new Date().getTime() / 1000) - 10000),
      ).to.be.revertedWith("Invalid maturity date");
    });

    it("should fail with invalid tranche ratios", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();

      const trancheImplementation = <Tranche>await deploy("Tranche", signers[0], []);
      const trancheFactory = <TrancheFactory>(
        await deploy("TrancheFactory", signers[0], [trancheImplementation.address])
      );

      const bondImplementation = <BondController>await deploy("BondController", signers[0], []);
      const bondFactory = <BondFactory>(
        await deploy("BondFactory", signers[0], [bondImplementation.address, trancheFactory.address])
      );

      const mockCollateralToken = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);
      await expect(
        bondFactory.connect(signers[0]).createBond(mockCollateralToken.address, [], new Date().getTime() + 10000),
      ).to.be.revertedWith("Invalid total tranche ratios");

      await expect(
        bondFactory.connect(signers[0]).createBond(mockCollateralToken.address, [10, 20], new Date().getTime() + 10000),
      ).to.be.revertedWith("Invalid total tranche ratios");

      await expect(
        bondFactory.connect(signers[0]).createBond(mockCollateralToken.address, [1005], new Date().getTime() + 10000),
      ).to.be.revertedWith("Invalid tranche ratio");

      await expect(
        bondFactory
          .connect(signers[0])
          .createBond(mockCollateralToken.address, [400, 500, 900], new Date().getTime() + 10000),
      ).to.be.revertedWith("Invalid total tranche ratios");
    });
  });

  describe("Deposit", function () {
    it("should successfully deposit collateral and mint tranche tokens", async () => {
      const trancheValues = [100, 200, 200, 500];
      const { bond, tranches, mockCollateralToken, user } = await setupTestContext(trancheValues);

      const amount = hre.ethers.utils.parseEther("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), bond.address, amount)
        .to.emit(bond, "Deposit")
        .withArgs(await user.getAddress(), amount);

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = hre.ethers.utils.parseEther(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue);
        expect(await tranche.balanceOf(await user.getAddress())).to.equal(trancheValue);
      }

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount);
      expect(await bond.totalDebt()).to.equal(amount);
    });

    it("should fail to deposit collateral if not approved", async () => {
      const trancheValues = [100, 200, 200, 500];
      const { bond, mockCollateralToken, user } = await setupTestContext(trancheValues);

      const amount = hre.ethers.utils.parseEther("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);

      await expect(bond.connect(user).deposit(amount)).to.be.revertedWith(
        "revert TransferHelper::transferFrom: transferFrom failed",
      );
    });
  });
});
