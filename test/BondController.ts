import { expect } from "chai";
import hre, { waffle } from "hardhat";
import { BigNumber, Signer } from "ethers";
import * as _ from "lodash";
import { Fixture } from "ethereum-waffle";
import { deploy } from "./utils/contracts";
import { BlockchainTime } from "./utils/time";
import { ZERO_ADDRESS } from "./utils/erc20";
const { loadFixture } = waffle;

import { BondController, BondFactory, MockERC20, Tranche, TrancheFactory } from "../typechain";
const parse = hre.ethers.utils.parseEther;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface TestContext {
  bond: BondController;
  bondFactory: BondFactory;
  tranches: Tranche[];
  mockCollateralToken: MockERC20;
  user: Signer;
  other: Signer;
  admin: Signer;
  signers: Signer[];
}

const time = new BlockchainTime();

describe("Bond Controller", () => {
  /**
   * Sets up a test context, deploying new contracts and returning them for use in a test
   */
  const setupTestContext = async (tranches: number[], depositLimit?: BigNumber): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();
    const [user, other, admin] = signers;

    const trancheImplementation = <Tranche>await deploy("Tranche", admin, []);
    const trancheFactory = <TrancheFactory>await deploy("TrancheFactory", admin, [trancheImplementation.address]);

    const bondImplementation = <BondController>await deploy("BondController", admin, []);
    const bondFactory = <BondFactory>(
      await deploy("BondFactory", admin, [bondImplementation.address, trancheFactory.address])
    );

    const mockCollateralToken = <MockERC20>await deploy("MockERC20", admin, ["Mock ERC20", "MOCK"]);

    let receipt;
    if (depositLimit) {
      const tx = await bondFactory
        .connect(admin)
        .createBondWithDepositLimit(
          mockCollateralToken.address,
          tranches,
          await time.secondsFromNow(10000),
          depositLimit,
        );
      receipt = await tx.wait();
    } else {
      const tx = await bondFactory
        .connect(admin)
        .createBond(mockCollateralToken.address, tranches, await time.secondsFromNow(10000));
      receipt = await tx.wait();
    }

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
      bondFactory,
      mockCollateralToken,
      tranches: trancheContracts,
      user,
      other,
      admin,
      signers: signers.slice(3),
    };
  };

  const fixture = async () => await setupTestContext([200, 300, 500]);
  const getFixture = (tranches: number[]): Fixture<TestContext> => {
    // in order for fixtures to actually save time, have to use the same instance for each run
    // so can't dynamically generate every time unless necessary
    if (_.isEqual(tranches, [200, 300, 500])) {
      return fixture;
    } else {
      return async () => await setupTestContext(tranches);
    }
  };

  describe("Initialization", function () {
    it("should successfully initialize a tranche bond", async () => {
      const { bond, tranches, mockCollateralToken, admin } = await loadFixture(getFixture([200, 300, 500]));
      expect(await bond.collateralToken()).to.equal(mockCollateralToken.address);
      // ensure user has admin permissions
      expect(await bond.owner()).to.equal(await admin.getAddress());
      expect(await bond.totalDebt()).to.equal(0);
      expect(await bond.isMature()).to.be.false;
      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const letter = i === tranches.length - 1 ? "Z" : LETTERS[i];
        expect(await tranche.collateralToken()).to.equal(mockCollateralToken.address);
        expect(await tranche.hasRole(hre.ethers.constants.HashZero, bond.address)).to.be.true;
        expect(await tranche.symbol()).to.equal(`TRANCHE-${await mockCollateralToken.symbol()}-${letter}`);
        expect(await tranche.name()).to.equal(`ButtonTranche ${await mockCollateralToken.symbol()} ${letter}`);
      }
    });

    it("should fail with zero address collateralToken", async () => {
      const tranches = [200, 300, 500];
      const { bondFactory, admin } = await loadFixture(getFixture(tranches));
      await expect(
        bondFactory
          .connect(admin)
          .createBond(hre.ethers.constants.AddressZero, tranches, await time.secondsFromNow(10000)),
      ).to.be.revertedWith("BondController: invalid collateralToken address");
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
          .createBond(mockCollateralToken.address, [500, 500], await time.secondsFromNow(-10000)),
      ).to.be.revertedWith("BondController: Invalid maturity date");
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
        bondFactory.connect(signers[0]).createBond(mockCollateralToken.address, [], await time.secondsFromNow(10000)),
      ).to.be.revertedWith("BondController: Invalid tranche ratios");

      await expect(
        bondFactory
          .connect(signers[0])
          .createBond(mockCollateralToken.address, [10, 20], await time.secondsFromNow(10000)),
      ).to.be.revertedWith("BondController: Invalid tranche ratios");

      await expect(
        bondFactory
          .connect(signers[0])
          .createBond(mockCollateralToken.address, [1005], await time.secondsFromNow(10000)),
      ).to.be.revertedWith("BondController: Invalid tranche ratio");

      await expect(
        bondFactory
          .connect(signers[0])
          .createBond(mockCollateralToken.address, [400, 500, 900], await time.secondsFromNow(10000)),
      ).to.be.revertedWith("BondController: Invalid tranche ratios");
    });

    it("gas [ @skip-on-coverage ]", async () => {
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
      const maturityDate = await time.secondsFromNow(10000);
      const tx = await bondFactory
        .connect(signers[0])
        .createBond(mockCollateralToken.address, [200, 300, 500], maturityDate);

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("914307");
    });
  });

  describe("Deposit", function () {
    it("should successfully deposit collateral and mint tranche tokens", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), bond.address, amount)
        .to.emit(bond, "Deposit")
        .withArgs(await user.getAddress(), amount, "0");

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue);
        expect(await tranche.balanceOf(await user.getAddress())).to.equal(trancheValue);
      }

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount);
      expect(await bond.totalDebt()).to.equal(amount);
    });

    it("should successfully deposit collateral with existing collateral", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user, other } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await bond.connect(user).deposit(amount);

      await mockCollateralToken.mint(await other.getAddress(), amount);
      await mockCollateralToken.connect(other).approve(bond.address, amount);
      await expect(bond.connect(other).deposit(amount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await other.getAddress(), bond.address, amount)
        .to.emit(bond, "Deposit")
        .withArgs(await other.getAddress(), amount, "0");

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue.mul(2));
        expect(await tranche.balanceOf(await other.getAddress())).to.equal(trancheValue);
      }

      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount.mul(2));
      expect(await bond.totalDebt()).to.equal(amount.mul(2));
    });

    it("should successfully deposit collateral with positive CD ratio", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user, other } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await bond.connect(user).deposit(amount);

      await mockCollateralToken.mint(await other.getAddress(), amount);
      await mockCollateralToken.connect(other).approve(bond.address, amount);
      // 2x rebase
      await mockCollateralToken.rebase(20000);
      await expect(bond.connect(other).deposit(amount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await other.getAddress(), bond.address, amount)
        .to.emit(bond, "Deposit")
        .withArgs(await other.getAddress(), amount, "0");

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue.div(2).mul(3));
        expect(await tranche.balanceOf(await other.getAddress())).to.equal(trancheValue.div(2));
      }

      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount.mul(4));
      expect(await bond.totalDebt()).to.equal(amount.div(2).mul(3));
    });

    it("should successfully deposit collateral with negative CD ratio", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user, other } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await bond.connect(user).deposit(amount);

      await mockCollateralToken.mint(await other.getAddress(), amount);
      await mockCollateralToken.connect(other).approve(bond.address, amount);
      // 1/2x rebase
      await mockCollateralToken.rebase(5000);
      await expect(bond.connect(other).deposit(amount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await other.getAddress(), bond.address, amount)
        .to.emit(bond, "Deposit")
        .withArgs(await other.getAddress(), amount, "0");

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue.mul(3));
        expect(await tranche.balanceOf(await other.getAddress())).to.equal(trancheValue.mul(2));
      }

      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount);
      expect(await bond.totalDebt()).to.equal(amount.mul(3));
    });

    it("should fail to deposit 0 collateral", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(0)).to.be.revertedWith("BondController: invalid amount");
    });

    it("should fail to deposit small collateral amount for first deposit", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(100)).to.be.revertedWith("BondController: invalid initial amount");
    });

    it("should fail to deposit if mature", async () => {
      const trancheValues = [100, 200, 200, 500];
      const { bond, mockCollateralToken, admin, user } = await setupTestContext(trancheValues);

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await bond.connect(admin).mature();

      await expect(bond.connect(user).deposit(amount)).to.be.revertedWith("BondController: Already mature");
    });

    it("should allow to deposit small collateral amount for second deposit", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(parse("1"))).to.not.be.reverted;
      await expect(bond.connect(user).deposit(100)).to.not.be.reverted;
    });

    it("should fail to deposit collateral if not approved", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);

      await expect(bond.connect(user).deposit(amount)).to.be.revertedWith(
        "TransferHelper::transferFrom: transferFrom failed",
      );
    });

    it("should fail to deposit beyond limit", async () => {
      const trancheValues = [200, 300, 500];
      const depositLimit = parse("100");
      const { bond, mockCollateralToken, user } = await setupTestContext(trancheValues, depositLimit);

      const amount = parse("50");
      await mockCollateralToken.mint(await user.getAddress(), amount.mul(3));
      await mockCollateralToken.connect(user).approve(bond.address, amount.mul(3));

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;
      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;
      await expect(bond.connect(user).deposit(amount)).to.be.revertedWith("BondController: Deposit limit");
    });

    it("should succeed if deposit limit is exceeded, then a redemption occurs", async () => {
      const trancheValues = [200, 300, 500];
      const depositLimit = parse("100");
      const { bond, mockCollateralToken, user } = await setupTestContext(trancheValues, depositLimit);

      const amount = parse("50");
      await mockCollateralToken.mint(await user.getAddress(), amount.mul(3));
      await mockCollateralToken.connect(user).approve(bond.address, amount.mul(3));

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;
      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;
      await expect(bond.connect(user).deposit(amount)).to.be.revertedWith("BondController: Deposit limit");

      // redeem to lower the locked collateral, then deposit should work again
      await expect(bond.connect(user).redeem([parse("10"), parse("15"), parse("25")])).to.not.be.reverted;
      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user } = await loadFixture(async () => await setupTestContext(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      const tx = await bond.connect(user).deposit(amount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("268227");
    });
  });

  describe("Mature", function () {
    const setup = async (trancheValues = [200, 300, 500]) => {
      const { bond, tranches, mockCollateralToken, user, admin } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await bond.connect(user).deposit(amount);
      return { bond, tranches, mockCollateralToken, user, admin };
    };

    it("should successfully mature bond from admin", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user, admin } = await setup(trancheValues);
      await expect(bond.connect(admin).mature())
        .to.emit(bond, "Mature")
        .withArgs(await admin.getAddress());

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue);
        expect(await tranche.balanceOf(await user.getAddress())).to.equal(trancheValue);
        expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(trancheValue);
      }
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(0);
      expect(await bond.isMature()).to.equal(true);
    });

    it("should successfully mature bond from user", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user, admin } = await setup(trancheValues);
      await time.increaseTime(10000);
      await expect(bond.connect(admin).mature())
        .to.emit(bond, "Mature")
        .withArgs(await admin.getAddress());

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue);
        expect(await tranche.balanceOf(await user.getAddress())).to.equal(trancheValue);
        expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(trancheValue);
      }
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(0);
      expect(await bond.isMature()).to.equal(true);
    });

    it("should successfully mature bond with valueless Z tranche", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, admin } = await setup(trancheValues);
      // 1/2 rebase
      await mockCollateralToken.rebase(5000);
      await expect(bond.connect(admin).mature())
        .to.emit(bond, "Mature")
        .withArgs(await admin.getAddress());

      for (let i = 0; i < tranches.length - 1; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue);
        expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(trancheValue);
      }

      expect(await mockCollateralToken.balanceOf(tranches[tranches.length - 1].address)).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(0);
      expect(await bond.isMature()).to.equal(true);
    });

    it("should successfully mature bond with doubled value", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, admin } = await setup(trancheValues);
      // 1/2 rebase
      await mockCollateralToken.rebase(20000);
      await expect(bond.connect(admin).mature())
        .to.emit(bond, "Mature")
        .withArgs(await admin.getAddress());

      for (let i = 0; i < tranches.length - 1; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue);
        expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(trancheValue);
      }

      expect(await mockCollateralToken.balanceOf(tranches[tranches.length - 1].address)).to.equal(parse("1500"));
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(0);
      expect(await bond.isMature()).to.equal(true);
    });

    it("should fail to mature from admin an already mature bond", async () => {
      const { bond, admin } = await setup();
      await bond.connect(admin).mature();
      await expect(bond.connect(admin).mature()).to.be.revertedWith("BondController: Already mature");
    });

    it("should fail to mature from user if maturity date is not passed", async () => {
      const { bond, user } = await setup();
      await expect(bond.connect(user).mature()).to.be.revertedWith("BondController: Invalid call to mature");
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const { bond, admin } = await setup();
      const tx = await bond.connect(admin).mature();

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("226644");
    });
  });

  describe("Deposit Fees", function () {
    it("should successfully set the fee as the admin", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin } = await loadFixture(getFixture(trancheValues));

      expect(await bond.feeBps()).to.equal("0");
      const fee = BigNumber.from("5");
      await expect(bond.connect(admin).setFee(fee)).to.emit(bond, "FeeUpdate").withArgs("5");

      expect(await bond.feeBps()).to.equal(fee);
    });

    it("should fail to set the fee as non-admin", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, user } = await loadFixture(getFixture(trancheValues));

      expect(await bond.feeBps()).to.equal("0");
      const fee = BigNumber.from("5");
      await expect(bond.connect(user).setFee(fee)).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should fail to set the fee outside of range", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin } = await loadFixture(getFixture(trancheValues));

      expect(await bond.feeBps()).to.equal("0");
      const fee = BigNumber.from("500");
      await expect(bond.connect(admin).setFee(fee)).to.be.revertedWith("BondController: New fee too high");
    });

    it("should successfully set the fee back to 0", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin } = await loadFixture(getFixture(trancheValues));

      expect(await bond.feeBps()).to.equal("0");
      const fee = BigNumber.from("5");
      await expect(bond.connect(admin).setFee(fee)).to.not.be.reverted;
      expect(await bond.feeBps()).to.equal(fee);
      await expect(bond.connect(admin).setFee(0)).to.not.be.reverted;
      expect(await bond.feeBps()).to.equal(0);
    });

    it("should successfully set the fee to max", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin } = await loadFixture(getFixture(trancheValues));

      expect(await bond.feeBps()).to.equal("0");
      const fee = BigNumber.from("50");
      await expect(bond.connect(admin).setFee(fee)).to.not.be.reverted;
      expect(await bond.feeBps()).to.equal(fee);
    });

    it("should not take any fee if fee is 0", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, user, tranches, mockCollateralToken } = await loadFixture(getFixture(trancheValues));

      expect(await bond.feeBps()).to.equal("0");

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue);
        expect(await tranche.balanceOf(await user.getAddress())).to.equal(trancheValue);
        expect(await tranche.balanceOf(bond.address)).to.equal(0);
      }

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount);
      expect(await bond.totalDebt()).to.equal(amount);
    });

    it("should take 5 bps fee", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin, user, tranches, mockCollateralToken } = await loadFixture(getFixture(trancheValues));

      const fee = BigNumber.from("5");
      await expect(bond.connect(admin).setFee(fee)).to.not.be.reverted;

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue);

        const feeAmount = trancheValue.mul(fee).div(10000);
        expect(await tranche.balanceOf(await user.getAddress())).to.equal(trancheValue.sub(feeAmount));
        expect(await tranche.balanceOf(bond.address)).to.equal(feeAmount);
      }

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount);
      expect(await bond.totalDebt()).to.equal(amount);
    });

    it("should take 50 bps fee", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin, user, tranches, mockCollateralToken } = await loadFixture(getFixture(trancheValues));

      const fee = BigNumber.from("50");
      await expect(bond.connect(admin).setFee(fee)).to.not.be.reverted;

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue);

        const feeAmount = trancheValue.mul(fee).div(10000);
        expect(await tranche.balanceOf(await user.getAddress())).to.equal(trancheValue.sub(feeAmount));
        expect(await tranche.balanceOf(bond.address)).to.equal(feeAmount);
      }

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount);
      expect(await bond.totalDebt()).to.equal(amount);
    });

    it("should redeem fee on maturity", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin, user, tranches, mockCollateralToken } = await loadFixture(getFixture(trancheValues));

      const fee = BigNumber.from("5");
      await expect(bond.connect(admin).setFee(fee)).to.not.be.reverted;

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;

      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal("0");
      await expect(bond.connect(admin).mature()).to.not.be.reverted;
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(amount.mul(fee).div(10000));

      for (let i = 0; i < tranches.length - 1; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        const feeAmount = trancheValue.mul(fee).div(10000);
        expect(await tranche.totalSupply()).to.equal(trancheValue.sub(feeAmount));
        expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(trancheValue.sub(feeAmount));
      }
    });

    it("should redeem fee from multiple transactions on maturity", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin, user, tranches, mockCollateralToken } = await loadFixture(getFixture(trancheValues));

      const fee = BigNumber.from("5");
      await expect(bond.connect(admin).setFee(fee)).to.not.be.reverted;

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount.mul(2));
      await mockCollateralToken.connect(user).approve(bond.address, amount.mul(2));

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;
      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;

      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal("0");
      await expect(bond.connect(admin).mature()).to.not.be.reverted;
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(amount.mul(2).mul(fee).div(10000));

      for (let i = 0; i < tranches.length - 1; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString()).mul(2);
        const feeAmount = trancheValue.mul(fee).div(10000);
        expect(await tranche.totalSupply()).to.equal(trancheValue.sub(feeAmount));
        expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(trancheValue.sub(feeAmount));
      }
    });

    it("should redeem after fees are taken", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin, user, tranches, mockCollateralToken } = await loadFixture(getFixture(trancheValues));

      const fee = BigNumber.from("5");
      await expect(bond.connect(admin).setFee(fee)).to.not.be.reverted;

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;

      const feeAmount = amount.mul(fee).div(10000);
      const userTrancheBalances = trancheValues.map(value =>
        parse(value.toString()).sub(parse(value.toString()).mul(fee).div(10000)),
      );
      // redeem all tranche tokens
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal("0");
      await expect(bond.connect(user).redeem(userTrancheBalances)).to.not.be.reverted;
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(amount.sub(feeAmount));

      // mature and claim fees
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal("0");
      await expect(bond.connect(admin).mature()).to.not.be.reverted;
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(feeAmount);

      for (let i = 0; i < tranches.length - 1; i++) {
        const tranche = tranches[i];
        expect(await tranche.totalSupply()).to.equal(0);
        expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(0);
      }
    });

    it("should redeemMature after fees are taken", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin, user, tranches, mockCollateralToken } = await loadFixture(getFixture(trancheValues));

      const fee = BigNumber.from("5");
      await expect(bond.connect(admin).setFee(fee)).to.not.be.reverted;

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;

      const feeAmount = amount.mul(fee).div(10000);

      // mature and claim fees
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal("0");
      await expect(bond.connect(admin).mature()).to.not.be.reverted;
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(feeAmount);

      // redeem all tranche tokens
      const userTrancheBalances = trancheValues.map(value =>
        parse(value.toString()).sub(parse(value.toString()).mul(fee).div(10000)),
      );
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal("0");
      await expect(bond.connect(user).redeemMature(tranches[0].address, userTrancheBalances[0])).to.not.be.reverted;
      await expect(bond.connect(user).redeemMature(tranches[1].address, userTrancheBalances[1])).to.not.be.reverted;
      await expect(bond.connect(user).redeemMature(tranches[2].address, userTrancheBalances[2])).to.not.be.reverted;
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(amount.sub(feeAmount));

      for (let i = 0; i < tranches.length - 1; i++) {
        const tranche = tranches[i];
        expect(await tranche.totalSupply()).to.equal(0);
        expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(0);
      }
    });

    it("should redeem and then redeemMature after fees are taken", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, admin, user, tranches, mockCollateralToken } = await loadFixture(getFixture(trancheValues));

      const fee = BigNumber.from("5");
      await expect(bond.connect(admin).setFee(fee)).to.not.be.reverted;

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount)).to.not.be.reverted;

      const feeAmount = amount.mul(fee).div(10000);

      // redeem half tranche tokens
      const userTrancheBalances = trancheValues.map(value =>
        parse(value.toString()).sub(parse(value.toString()).mul(fee).div(10000)),
      );
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal("0");
      await expect(bond.connect(user).redeem(userTrancheBalances.map(bal => bal.div(2)))).to.not.be.reverted;
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(
        amount.div(2).sub(feeAmount.div(2)),
      );

      // mature and claim fees
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal("0");
      await expect(bond.connect(admin).mature()).to.not.be.reverted;
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(feeAmount);

      // redeem all tranche tokens
      await expect(bond.connect(user).redeemMature(tranches[0].address, userTrancheBalances[0].div(2))).to.not.be
        .reverted;
      await expect(bond.connect(user).redeemMature(tranches[1].address, userTrancheBalances[1].div(2))).to.not.be
        .reverted;
      await expect(bond.connect(user).redeemMature(tranches[2].address, userTrancheBalances[2].div(2))).to.not.be
        .reverted;
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(amount.sub(feeAmount));

      for (let i = 0; i < tranches.length - 1; i++) {
        const tranche = tranches[i];
        expect(await tranche.totalSupply()).to.equal(0);
        expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(0);
      }
    });
  });

  describe("redeemMature", async () => {
    const setup = async (trancheValues = [200, 300, 500]) => {
      const { bond, tranches, mockCollateralToken, user, admin } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await bond.connect(user).deposit(amount);
      await bond.connect(admin).mature();
      return { bond, tranches, mockCollateralToken, user };
    };

    it("should successfully redeem all tranches", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await setup(trancheValues);

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        await expect(bond.connect(user).redeemMature(tranche.address, trancheValue))
          .to.emit(bond, "RedeemMature")
          .withArgs(await user.getAddress(), tranche.address, trancheValue)
          .to.emit(mockCollateralToken, "Transfer")
          .withArgs(tranche.address, await user.getAddress(), trancheValue);
      }
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("1000"));
      expect(await bond.totalDebt()).to.equal(0);
    });

    it("should fail to redeem an immature bond", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await bond.connect(user).deposit(amount);
      await expect(bond.connect(user).redeemMature(tranches[0].address, parse("200"))).to.be.revertedWith(
        "BondController: Bond is not mature",
      );
    });

    it("should fail to call redeem with an unassociated address", async () => {
      const { bond, user } = await setup();

      await expect(bond.connect(user).redeemMature(await user.getAddress(), parse("200"))).to.be.revertedWith(
        "BondController: Invalid tranche address",
      );
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, user } = await setup(trancheValues);

      const tx = await bond.connect(user).redeemMature(tranches[0].address, parse(trancheValues[0].toString()));

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("81436");
    });
  });

  describe("redeem", async () => {
    const setup = async (trancheValues = [200, 300, 500]) => {
      const { bond, tranches, mockCollateralToken, user, admin } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await bond.connect(user).deposit(amount);
      return { bond, tranches, mockCollateralToken, user, admin };
    };

    it("should successfully redeem an immature bond with all tranches", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await setup(trancheValues);

      await expect(bond.connect(user).redeem([parse("200"), parse("300"), parse("500")]))
        .to.emit(bond, "Redeem")
        .withArgs(await user.getAddress(), [parse("200"), parse("300"), parse("500")])
        .to.emit(tranches[0], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("200"))
        .to.emit(tranches[1], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("300"))
        .to.emit(tranches[2], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("500"));

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("1000"));
    });

    it("should successfully redeem an immature bond after positive rebase", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await setup(trancheValues);

      // 2x rebase
      await mockCollateralToken.rebase(20000);

      await expect(bond.connect(user).redeem([parse("200"), parse("300"), parse("500")]))
        .to.emit(bond, "Redeem")
        .withArgs(await user.getAddress(), [parse("200"), parse("300"), parse("500")])
        .to.emit(tranches[0], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("200"))
        .to.emit(tranches[1], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("300"))
        .to.emit(tranches[2], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("500"));

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("2000"));
    });

    it("should successfully redeem an immature bond after negative rebase", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await setup(trancheValues);

      // 2x rebase
      await mockCollateralToken.rebase(5000);

      await expect(bond.connect(user).redeem([parse("200"), parse("300"), parse("500")]))
        .to.emit(bond, "Redeem")
        .withArgs(await user.getAddress(), [parse("200"), parse("300"), parse("500")])
        .to.emit(tranches[0], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("200"))
        .to.emit(tranches[1], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("300"))
        .to.emit(tranches[2], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("500"));

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("500"));
    });

    it("should fail to redeem a mature bond", async () => {
      const { bond, user, admin } = await setup();
      await bond.connect(admin).mature();

      await expect(bond.connect(user).redeem([200, 300, 500])).to.be.revertedWith(
        "BondController: Bond is already mature",
      );
    });

    it("should fail to redeem with invalid redeem amounts", async () => {
      const { bond, user } = await setup();

      await expect(bond.connect(user).redeem([100, 200, 300, 500])).to.be.revertedWith(
        "BondController: Invalid redeem amounts",
      );
      await expect(bond.connect(user).redeem([500, 500])).to.be.revertedWith("BondController: Invalid redeem amounts");
    });

    it("should fail to redeem out of ratio", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, user } = await setup(trancheValues);

      await expect(bond.connect(user).redeem([100, 300, 500])).to.be.revertedWith(
        "BondController: Invalid redemption ratio",
      );
    });

    it("should fail to redeem more than owned", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, user } = await setup(trancheValues);

      await expect(bond.connect(user).redeem([parse("400"), parse("600"), parse("1000")])).to.be.revertedWith(
        "ERC20: burn amount exceeds balance",
      );
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, user } = await setup(trancheValues);

      const tx = await bond.connect(user).redeem([parse("200"), parse("300"), parse("500")]);

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("119720");
    });
  });
});
