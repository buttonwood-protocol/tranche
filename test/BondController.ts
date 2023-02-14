import { expect } from "chai";
import hre, { waffle } from "hardhat";
import { BigNumber, BigNumberish, Signer } from "ethers";
import * as _ from "lodash";
import { Fixture } from "ethereum-waffle";
import { deploy } from "./utils/contracts";
import { BlockchainTime } from "./utils/time";
import { ZERO_ADDRESS } from "./utils/erc20";
const { loadFixture } = waffle;

import { BondController, BondFactory, MockRebasingERC20, Tranche, TrancheFactory, UFragments } from "../typechain";
import { parseUnits } from "ethers/lib/utils";
const parse = hre.ethers.utils.parseEther;
const ampleParse = (value: string) => hre.ethers.utils.parseUnits(value, 9);
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const expectEqWithEpsilon = (a: BigNumberish, b: BigNumberish, epsilon: BigNumberish) => {
  expect(BigNumber.from(a).sub(b).abs()).to.be.lte(epsilon);
};

interface TestContext {
  bond: BondController;
  bondFactory: BondFactory;
  tranches: Tranche[];
  mockCollateralToken: MockRebasingERC20;
  user: Signer;
  other: Signer;
  admin: Signer;
  signers: Signer[];
  maturityDate: number;
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

    const mockCollateralToken = <MockRebasingERC20>await deploy("MockRebasingERC20", admin, ["Mock ERC20", "MOCK", 18]);

    const maturityDate = await time.secondsFromNow(10000);
    let receipt;
    if (depositLimit) {
      const tx = await bondFactory
        .connect(admin)
        .createBondWithDepositLimit(mockCollateralToken.address, tranches, maturityDate, depositLimit);
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
      maturityDate,
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
      const { bond, tranches, mockCollateralToken, admin, maturityDate } = await loadFixture(
        getFixture([200, 300, 500]),
      );
      expect(await bond.collateralToken()).to.equal(mockCollateralToken.address);
      // ensure user has admin permissions
      expect(await bond.owner()).to.equal(await admin.getAddress());
      expect(await bond.totalDebt()).to.equal(0);
      expect(await bond.isMature()).to.be.false;
      expect(await bond.creationDate()).to.be.gt("0");
      expect(await bond.maturityDate()).to.be.eq(maturityDate);
      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const letter = i === tranches.length - 1 ? "Z" : LETTERS[i];
        expect(await tranche.collateralToken()).to.equal(mockCollateralToken.address);
        expect(await tranche.bond()).to.equal(bond.address);
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

    it("should fail with over 26 tranches", async () => {
      const tranches = [500, 250];
      for (let i = 0; i < 25; i++) {
        tranches.push(10);
      }
      const { bondFactory, admin, mockCollateralToken } = await loadFixture(getFixture([200, 300, 500]));
      await expect(
        bondFactory.connect(admin).createBond(mockCollateralToken.address, tranches, await time.secondsFromNow(10000)),
      ).to.be.revertedWith("BondController: invalid tranche count");
    });

    it("should succeed with exactly 26 tranches", async () => {
      const trancheRatios = [750];
      for (let i = 0; i < 25; i++) {
        trancheRatios.push(10);
      }
      const { bond, tranches, mockCollateralToken } = await loadFixture(getFixture(trancheRatios));
      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const letter = i === tranches.length - 1 ? "Z" : LETTERS[i];
        expect(await tranche.collateralToken()).to.equal(mockCollateralToken.address);
        expect(await tranche.bond()).to.equal(bond.address);
        expect(await tranche.symbol()).to.equal(`TRANCHE-${await mockCollateralToken.symbol()}-${letter}`);
        expect(await tranche.name()).to.equal(`ButtonTranche ${await mockCollateralToken.symbol()} ${letter}`);
      }
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

      const mockCollateralToken = <MockRebasingERC20>(
        await deploy("MockRebasingERC20", signers[0], ["Mock ERC20", "MOCK", 18])
      );
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

      const mockCollateralToken = <MockRebasingERC20>(
        await deploy("MockRebasingERC20", signers[0], ["Mock ERC20", "MOCK", 9])
      );
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

      const mockCollateralToken = <MockRebasingERC20>(
        await deploy("MockRebasingERC20", signers[0], ["Mock ERC20", "MOCK", 9])
      );
      const maturityDate = await time.secondsFromNow(10000);
      const tx = await bondFactory
        .connect(signers[0])
        .createBond(mockCollateralToken.address, [200, 300, 500], maturityDate);

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("867197");
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

    it("should successfully deposit collateral and mint tranche tokens after small collateral transfer", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user, admin } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      // deposit tiny amount of collateral to try to break the mint calculation
      await mockCollateralToken.mint(bond.address, "1");

      await expect(bond.connect(user).deposit(amount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(bond.address, await admin.getAddress(), "1")
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
      // Extra tiny collateral transfer was already sent to owner
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

      // User deposits 1000
      await bond.connect(user).deposit(amount);

      await mockCollateralToken.mint(await other.getAddress(), amount);
      await mockCollateralToken.connect(other).approve(bond.address, amount);

      // 2x rebase
      await mockCollateralToken.setMultiplier(20000);

      // Balance Check: User: 0, bond: 2000, other: 2000
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(parse("2000"));
      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(parse("2000"));

      // Other deposits 1000
      await expect(bond.connect(other).deposit(amount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await other.getAddress(), bond.address, amount)
        .to.emit(bond, "Deposit")
        .withArgs(await other.getAddress(), amount, "0");

      // Balance Check: User: 0, bond: 3000, other: 1000
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(parse("3000"));
      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(parse("1000"));

      // Tranche check
      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue.div(2).mul(3));
        expect(await tranche.balanceOf(await other.getAddress())).to.equal(trancheValue.div(2));
      }

      // Checking totalDebt
      expect(await bond.totalDebt()).to.equal(amount.div(2).mul(3));
    });

    it("should successfully deposit collateral with negative CD ratio", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user, other } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      // User deposits 1000
      await bond.connect(user).deposit(amount);

      await mockCollateralToken.mint(await other.getAddress(), amount);
      await mockCollateralToken.connect(other).approve(bond.address, amount);

      // 1/2x rebase
      await mockCollateralToken.setMultiplier(5000);

      // Balance Check: User: 0, bond: 500, other: 1000
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(parse("500"));
      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(parse("500"));

      // Other deposits entire balance (half of original minting amount)
      const halfAmount = parse("500");
      await expect(bond.connect(other).deposit(halfAmount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await other.getAddress(), bond.address, halfAmount)
        .to.emit(bond, "Deposit")
        .withArgs(await other.getAddress(), halfAmount, "0");

      // Balance Check: User: 0, bond: 1000, other: 0
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(parse("1000"));
      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(0);

      // Tranche check
      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const trancheValue = parse(trancheValues[i].toString());
        expect(await tranche.totalSupply()).to.equal(trancheValue.mul(2));
        expect(await tranche.balanceOf(await other.getAddress())).to.equal(trancheValue);
      }

      // Checking totalDebt
      expect(await bond.totalDebt()).to.equal(amount.mul(2));
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

      await expect(bond.connect(user).deposit(100)).to.be.revertedWith("BondController: Expected minimum valid debt");
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

    it("should successfully mint correct amount of tranche tokens after extraneous transfer", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, admin, signers } = await loadFixture(getFixture(trancheValues));
      const [userA, userB, userC] = signers;

      const amount1k = parse("1000");

      // UserA mints and deposits 1000 collateral
      await mockCollateralToken.mint(await userA.getAddress(), amount1k);
      await mockCollateralToken.connect(userA).approve(bond.address, amount1k);
      await bond.connect(userA).deposit(amount1k);
      // A-token supply is 200, UserA has balance of 200 As
      expect(await tranches[0].totalSupply()).to.equal(parse("200"));
      expect(await tranches[0].balanceOf(await userA.getAddress())).to.equal(parse("200"));
      // B-token supply is 300, UserA has balance of 300 Bs
      expect(await tranches[1].totalSupply()).to.equal(parse("300"));
      expect(await tranches[1].balanceOf(await userA.getAddress())).to.equal(parse("300"));
      // Z-token supply is 500, UserA has balance of 500 Zs
      expect(await tranches[2].totalSupply()).to.equal(parse("500"));
      expect(await tranches[2].balanceOf(await userA.getAddress())).to.equal(parse("500"));

      // UserB mints and sends 1000 collateral to the bond without depositing
      await mockCollateralToken.mint(await userB.getAddress(), amount1k);
      await mockCollateralToken.connect(userB).transfer(bond.address, amount1k);

      // UserC mints and deposits 1000 collateral
      await mockCollateralToken.mint(await userC.getAddress(), amount1k);
      await mockCollateralToken.connect(userC).approve(bond.address, amount1k);
      await bond.connect(userC).deposit(amount1k);
      // A-token supply is 400, UserC has balance of 200 As
      expect(await tranches[0].totalSupply()).to.equal(parse("400"));
      expect(await tranches[0].balanceOf(await userC.getAddress())).to.equal(parse("200"));
      // B-token supply is 600, UserC has balance of 300 Bs
      expect(await tranches[1].totalSupply()).to.equal(parse("600"));
      expect(await tranches[1].balanceOf(await userC.getAddress())).to.equal(parse("300"));
      // Z-token supply is 1000, UserC has balance of 500 Zs
      expect(await tranches[2].totalSupply()).to.equal(parse("1000"));
      expect(await tranches[2].balanceOf(await userC.getAddress())).to.equal(parse("500"));

      // Validating tokens have been transferred
      expect(await mockCollateralToken.balanceOf(await userA.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await userB.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await userC.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(amount1k);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount1k.mul(2));
      expect(await bond.totalDebt()).to.equal(amount1k.mul(2));
    });

    it("should successfully mint correct amount of tranche tokens with rebases and extraneous transfers", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, admin, signers } = await loadFixture(getFixture(trancheValues));
      const [userA, userB, userC] = signers;

      const amount1k = parse("1000");

      // UserA mints and deposits 1000 collateral
      await mockCollateralToken.mint(await userA.getAddress(), amount1k);
      await mockCollateralToken.connect(userA).approve(bond.address, amount1k);
      await bond.connect(userA).deposit(amount1k);
      // A-token supply is 200, UserA has balance of 200 As
      expect(await tranches[0].totalSupply()).to.equal(parse("200"));
      expect(await tranches[0].balanceOf(await userA.getAddress())).to.equal(parse("200"));
      // B-token supply is 300, UserA has balance of 300 Bs
      expect(await tranches[1].totalSupply()).to.equal(parse("300"));
      expect(await tranches[1].balanceOf(await userA.getAddress())).to.equal(parse("300"));
      // Z-token supply is 500, UserA has balance of 500 Zs
      expect(await tranches[2].totalSupply()).to.equal(parse("500"));
      expect(await tranches[2].balanceOf(await userA.getAddress())).to.equal(parse("500"));

      // Rebasing x2
      await mockCollateralToken.setMultiplier(20000);

      // UserB mints and sends 1000 collateral to the bond without depositing
      await mockCollateralToken.mint(await userB.getAddress(), amount1k);
      await mockCollateralToken.connect(userB).transfer(bond.address, amount1k);

      // Rebasing x2
      await mockCollateralToken.setMultiplier(40000);

      // UserB mints and sends 1000 collateral to the bond without depositing
      await mockCollateralToken.mint(await userB.getAddress(), amount1k);
      await mockCollateralToken.connect(userB).transfer(bond.address, amount1k);

      // UserC mints and deposits 1000 collateral
      await mockCollateralToken.mint(await userC.getAddress(), amount1k);
      await mockCollateralToken.connect(userC).approve(bond.address, amount1k);
      await bond.connect(userC).deposit(amount1k);
      // A-token supply is 400, UserC has balance of 200 As
      expect(await tranches[0].totalSupply()).to.equal(parse("250"));
      expect(await tranches[0].balanceOf(await userC.getAddress())).to.equal(parse("50"));
      // B-token supply is 600, UserC has balance of 300 Bs
      expect(await tranches[1].totalSupply()).to.equal(parse("375"));
      expect(await tranches[1].balanceOf(await userC.getAddress())).to.equal(parse("75"));
      // Z-token supply is 1000, UserC has balance of 500 Zs
      expect(await tranches[2].totalSupply()).to.equal(parse("625"));
      expect(await tranches[2].balanceOf(await userC.getAddress())).to.equal(parse("125"));

      // Rebasing x1.25
      await mockCollateralToken.setMultiplier(50000);

      // Validating tokens have been transferred
      expect(await mockCollateralToken.balanceOf(await userA.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await userB.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await userC.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(parse("3750"));
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(parse("6250"));
      expect(await bond.totalDebt()).to.equal(parse("1250"));
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
      expect(gasUsed.toString()).to.equal("296633");
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
      await mockCollateralToken.setMultiplier(5000);
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
      await mockCollateralToken.setMultiplier(20000);
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
      expect(gasUsed.toString()).to.equal("229813");
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
      const { bond, tranches, mockCollateralToken, user, admin, other } = await loadFixture(getFixture(trancheValues));

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await bond.connect(user).deposit(amount);
      await bond.connect(admin).mature();
      return { bond, tranches, mockCollateralToken, user, other };
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

    it("should redeemMature correct amounts and leave post-mature extraneous collateral locked in contract", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user, admin, other } = await loadFixture(getFixture(trancheValues));

      // User deposits 9999 collateral
      const amount = parse("9999");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);
      await bond.connect(user).deposit(amount);

      // Balance check user: 0, bond: 9999, other: 0, admin: 0
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount);
      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(0);

      // Total debt should be 9999 at this point
      expect(await bond.totalDebt()).to.equal(amount);

      // Admin matures the bond
      await bond.connect(admin).mature();

      // Other transfers an extraneous 5678 collateral (not through a deposit)
      const extraneousAmount = parse("5678");
      await mockCollateralToken.mint(await other.getAddress(), extraneousAmount);
      await mockCollateralToken.connect(other).transfer(bond.address, extraneousAmount);

      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const userTrancheBalance = await tranche.balanceOf(await user.getAddress());
        const trancheCollateral = await mockCollateralToken.balanceOf(tranche.address);
        await expect(bond.connect(user).redeemMature(tranche.address, userTrancheBalance))
          .to.emit(bond, "RedeemMature")
          .withArgs(await user.getAddress(), tranche.address, trancheCollateral)
          .to.emit(mockCollateralToken, "Transfer")
          .withArgs(tranche.address, await user.getAddress(), trancheCollateral);
      }
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(amount);

      // Validating bond total debt is emptied
      expect(await bond.totalDebt()).to.equal(0);

      // Validating bond has all the post-maturation extraneous collateral and that admin still has 0 collateral
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(extraneousAmount);
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(0);
    });

    it("should redeemMature correct amounts and transfer pre-mature extraneous collateral to admin", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user, admin, other } = await loadFixture(getFixture(trancheValues));

      // User deposits 1000 collateral
      const amount = parse("1234");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);
      await bond.connect(user).deposit(amount);

      // Balance check user: 0, bond: 1234, other: 0, admin: 0
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount);
      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(0);

      // Total debt should be 1234 at this point
      expect(await bond.totalDebt()).to.equal(amount);

      // Other transfers an extraneous 5678 collateral (not through a deposit)
      const extraneousAmount = parse("5678");
      await mockCollateralToken.mint(await other.getAddress(), extraneousAmount);
      await mockCollateralToken.connect(other).transfer(bond.address, extraneousAmount);

      // Admin matures the bond and has extraneous collateral transferred to them (as owner of the bond)
      await expect(bond.connect(admin).mature())
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(bond.address, await admin.getAddress(), extraneousAmount);

      // Validating tranches all have expected amounts
      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        const userTrancheBalance = await tranche.balanceOf(await user.getAddress());
        const trancheCollateral = await mockCollateralToken.balanceOf(tranche.address);
        await expect(bond.connect(user).redeemMature(tranche.address, userTrancheBalance))
          .to.emit(bond, "RedeemMature")
          .withArgs(await user.getAddress(), tranche.address, trancheCollateral)
          .to.emit(mockCollateralToken, "Transfer")
          .withArgs(tranche.address, await user.getAddress(), trancheCollateral);
      }

      // Validating user has expected amount of collateral returned
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(amount);

      // Validating bond total debt is emptied
      expect(await bond.totalDebt()).to.equal(0);

      // Validating bond has correct collateral and admin has all the extraneous collateral
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(extraneousAmount);
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, user } = await setup(trancheValues);

      const tx = await bond.connect(user).redeemMature(tranches[0].address, parse(trancheValues[0].toString()));

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("81278");
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

    it("should revert when trying to lower collateral below `MINIMUM_VALID_DEBT`", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user } = await setup(trancheValues);

      // Early redeeming below minimum valid debt (0.00000001)
      await expect(
        bond.connect(user).redeem([parse("199.9999999998"), parse("299.9999999997"), parse("499.9999999995")]),
      ).to.be.revertedWith("BondController: Expected minimum valid debt");

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("0"));
      expect(await bond.totalDebt()).to.equal(parse("1000"));
    });

    it("shouldn't revert when withdrawing collateral exactly to `MINIMUM_VALID_DEBT`", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await setup(trancheValues);

      // Early redeeming until just 0.00000001 is left
      await expect(bond.connect(user).redeem([parse("199.999999998"), parse("299.999999997"), parse("499.999999995")]))
        .to.emit(bond, "Redeem")
        .withArgs(await user.getAddress(), [parse("199.999999998"), parse("299.999999997"), parse("499.999999995")])
        .to.emit(tranches[0], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("199.999999998"))
        .to.emit(tranches[1], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("299.999999997"))
        .to.emit(tranches[2], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("499.999999995"));

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("999.99999999"));
      expect(await bond.totalDebt()).to.equal(parse("0.00000001"));
    });

    it("should revert when withdrawing collateral exactly to 0", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user } = await setup(trancheValues);

      // Early redeeming entire amount
      await expect(bond.connect(user).redeem([parse("200"), parse("300"), parse("500")])).to.be.revertedWith(
        "BondController: Expected minimum valid debt",
      );

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("0"));
      expect(await bond.totalDebt()).to.equal(parse("1000"));
    });

    it("should successfully redeem an immature bond with all tranches", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await setup(trancheValues);

      // Early redeeming half of each tranche
      await expect(bond.connect(user).redeem([parse("100"), parse("150"), parse("250")]))
        .to.emit(bond, "Redeem")
        .withArgs(await user.getAddress(), [parse("100"), parse("150"), parse("250")])
        .to.emit(tranches[0], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("100"))
        .to.emit(tranches[1], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("150"))
        .to.emit(tranches[2], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("250"));

      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("500"));
    });

    it("should successfully redeem an immature bond after positive rebase", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await setup(trancheValues);

      // 2x rebase
      await mockCollateralToken.setMultiplier(20000);

      // Early redeeming half of each tranche
      await expect(bond.connect(user).redeem([parse("100"), parse("150"), parse("250")]))
        .to.emit(bond, "Redeem")
        .withArgs(await user.getAddress(), [parse("100"), parse("150"), parse("250")])
        .to.emit(tranches[0], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("100"))
        .to.emit(tranches[1], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("150"))
        .to.emit(tranches[2], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("250"));

      // 2x what was deposited
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("1000"));
    });

    it("should successfully redeem an immature bond after negative rebase", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await setup(trancheValues);

      // 0.5x rebase
      await mockCollateralToken.setMultiplier(5000);

      // Early redeeming half of each tranche
      await expect(bond.connect(user).redeem([parse("100"), parse("150"), parse("250")]))
        .to.emit(bond, "Redeem")
        .withArgs(await user.getAddress(), [parse("100"), parse("150"), parse("250")])
        .to.emit(tranches[0], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("100"))
        .to.emit(tranches[1], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("150"))
        .to.emit(tranches[2], "Transfer")
        .withArgs(await user.getAddress(), ZERO_ADDRESS, parse("250"));

      // .25x what was deposited
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(parse("250"));
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
      const { bond, user, admin, mockCollateralToken } = await setup(trancheValues);

      // Depositing a lot extra from another user to avoid triggering withdraw limit error
      const amount = parse("10000");
      await mockCollateralToken.mint(await admin.getAddress(), amount);
      await mockCollateralToken.connect(admin).approve(bond.address, amount);
      await bond.connect(admin).deposit(amount);

      // User trying to withdraw 2x what they own
      await expect(bond.connect(user).redeem([parse("400"), parse("600"), parse("1000")])).to.be.revertedWith(
        "ERC20: burn amount exceeds balance",
      );
    });

    it("should early-redeem correct amounts and transfer pre-mature extraneous collateral to owner", async () => {
      const trancheValues = [200, 300, 500];
      const {
        bond,
        tranches,
        mockCollateralToken,
        admin,
        user: userA,
        other: userB,
      } = await loadFixture(getFixture(trancheValues));

      // Admin deposits minimum deposit amount into the bond
      const minimumValidDebt = BigNumber.from(10).pow(10);
      await mockCollateralToken.mint(await admin.getAddress(), minimumValidDebt);
      await mockCollateralToken.connect(admin).approve(bond.address, minimumValidDebt);
      await bond.connect(admin).deposit(minimumValidDebt);

      // Mint 1000 collateral to userA and approve it for bond
      const amount1k = parse("1000");
      await mockCollateralToken.mint(await userA.getAddress(), amount1k);
      await mockCollateralToken.connect(userA).approve(bond.address, amount1k);

      // UserA deposits 1000 collateral
      await bond.connect(userA).deposit(amount1k);
      // A-token supply is 200, UserA has balance of 200 As
      expect(await tranches[0].totalSupply()).to.equal(parse("200").add(parseUnits("2", "9")));
      expect(await tranches[0].balanceOf(await userA.getAddress())).to.equal(parse("200"));
      // B-token supply is 300, UserA has balance of 300 Bs
      expect(await tranches[1].totalSupply()).to.equal(parse("300").add(parseUnits("3", "9")));
      expect(await tranches[1].balanceOf(await userA.getAddress())).to.equal(parse("300"));
      // Z-token supply is 500, UserA has balance of 500 Zs
      expect(await tranches[2].totalSupply()).to.equal(parse("500").add(parseUnits("5", "9")));
      expect(await tranches[2].balanceOf(await userA.getAddress())).to.equal(parse("500"));

      // Mint extraneous collateral to userB who sends it to the bond without depositing
      const extraneousAmount = parse("987656432109876543210");
      await mockCollateralToken.mint(await userB.getAddress(), extraneousAmount);
      await mockCollateralToken.connect(userB).transfer(bond.address, extraneousAmount);

      // Validating tokens have been transferred
      expect(await mockCollateralToken.balanceOf(await userA.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await userB.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(
        amount1k.add(extraneousAmount).add(minimumValidDebt),
      );
      expect(await bond.totalDebt()).to.equal(amount1k.add(minimumValidDebt));

      // UserA early-redeems all of their A, B, and Z tokens
      await bond.connect(userA).redeem([parse("200"), parse("300"), parse("500")]);

      // UserA gets all of their 1000 collateral back
      expect(await mockCollateralToken.balanceOf(await userA.getAddress())).to.equal(amount1k);

      // Validating bond total debt is emptied
      expect(await bond.totalDebt()).to.equal(minimumValidDebt);

      // Validating bond has correct collateral and admin has all the extraneous collateral
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(minimumValidDebt);
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(extraneousAmount);
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, user } = await setup(trancheValues);

      // Early redeeming half of each tranche
      const tx = await bond.connect(user).redeem([parse("100"), parse("150"), parse("250")]);

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("157707");
    });
  });

  describe("Extraneous Collateral", function () {
    it("No skimming to admin when there's no extraneous collateral", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user, admin } = await loadFixture(getFixture(trancheValues));

      // User mints 1000 collateral and deposits it
      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);
      await expect(bond.connect(user).deposit(amount));

      // Admin has no collateral
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(0);
    });

    it("Admin should get skim when there is (pre-mature) extraneous collateral", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user, other, admin } = await loadFixture(getFixture(trancheValues));

      // other mints 1000 collateral and extraneously sends it to the bond
      const extraneousAmount = parse("5678901234");
      await mockCollateralToken.mint(await other.getAddress(), extraneousAmount);
      await mockCollateralToken.connect(other).transfer(bond.address, extraneousAmount);

      // Balance Check - user: 0, other: 0, bond: 5678901234, admin: 0
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(extraneousAmount);
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(0);

      // User mints 4321 collateral and deposits it
      const amount = parse("4321");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);
      await expect(bond.connect(user).deposit(amount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(bond.address, await admin.getAddress(), extraneousAmount);

      // Balance Check - user: 0, other: 0, bond: 4321, admin: 5678901234
      expect(await mockCollateralToken.balanceOf(await user.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(await other.getAddress())).to.equal(0);
      expect(await mockCollateralToken.balanceOf(bond.address)).to.equal(amount);
      expect(await mockCollateralToken.balanceOf(await admin.getAddress())).to.equal(extraneousAmount);
    });
  });

  it("Virtual balance matches collateral balance when there are no extraneous deposits", async () => {
    const trancheValues = [200, 300, 500];
    const { bond, mockCollateralToken, user } = await loadFixture(getFixture(trancheValues));

    // User mints 1000 collateral and deposits it
    const amount = parse("1000");
    await mockCollateralToken.mint(await user.getAddress(), amount);
    await mockCollateralToken.connect(user).approve(bond.address, amount);
    await expect(bond.connect(user).deposit(amount));

    // Virtual balance should match collateral balance
    const virtualCollateralBalance = await bond.collateralBalance();
    const collateralBalance = await mockCollateralToken.balanceOf(bond.address);
    expect(virtualCollateralBalance).to.equal(collateralBalance);
  });

  it("Virtual balance equals deposit amounts", async () => {
    const trancheValues = [200, 300, 500];
    const { bond, mockCollateralToken, user, other } = await loadFixture(getFixture(trancheValues));

    // User mints 4321 collateral and deposits it
    const amount = parse("7799");
    await mockCollateralToken.mint(await user.getAddress(), amount);
    await mockCollateralToken.connect(user).approve(bond.address, amount);
    await expect(bond.connect(user).deposit(amount));

    // other mints 1000 collateral and extraneously sends it to the bond
    const extraneousAmount = parse("9876");
    await mockCollateralToken.mint(await other.getAddress(), extraneousAmount);
    await mockCollateralToken.connect(other).transfer(bond.address, extraneousAmount);

    // Virtual balance should match deposited amounts and collateral balance minus extraneous collateral
    const virtualCollateralBalance = await bond.collateralBalance();
    const collateralBalance = await mockCollateralToken.balanceOf(bond.address);
    expect(virtualCollateralBalance).to.equal(amount);
    expect(virtualCollateralBalance).to.equal(collateralBalance.sub(extraneousAmount));
  });
});

interface AmplTestContext {
  bond: BondController;
  bondFactory: BondFactory;
  tranches: Tranche[];
  ampl: UFragments;
  userA: Signer; // deposits and mature redeems
  userB: Signer; // deposits and early redeems
  userC: Signer; // griefer
  admin: Signer;
  amplOwner: Signer;
  signers: Signer[];
  maturityDate: number;
  rebase: (multiplier: number) => Promise<void>;
  mint: (to: string, amount: BigNumberish) => Promise<void>;
}

describe("Bond Controller: Ampl Stress-Testing", () => {
  /**
   * Sets up a test context for Ampl, deploying new contracts and returning them for use in a test
   */
  const setupTestContext = async (tranches: number[], depositLimit?: BigNumber): Promise<AmplTestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();
    const [userA, userB, userC, admin, amplOwner] = signers;

    const ampl = <UFragments>await deploy("UFragments", amplOwner, []);
    await ampl["initialize(address)"](await amplOwner.getAddress());
    await ampl.setMonetaryPolicy(await amplOwner.getAddress());

    const trancheImplementation = <Tranche>await deploy("Tranche", admin, []);
    const trancheFactory = <TrancheFactory>await deploy("TrancheFactory", admin, [trancheImplementation.address]);

    const bondImplementation = <BondController>await deploy("BondController", admin, []);
    const bondFactory = <BondFactory>(
      await deploy("BondFactory", admin, [bondImplementation.address, trancheFactory.address])
    );

    const maturityDate = await time.secondsFromNow(10000);
    let receipt;
    if (depositLimit) {
      const tx = await bondFactory
        .connect(admin)
        .createBondWithDepositLimit(ampl.address, tranches, maturityDate, depositLimit);
      receipt = await tx.wait();
    } else {
      const tx = await bondFactory.connect(admin).createBond(ampl.address, tranches, await time.secondsFromNow(10000));
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

    const rebase = async (multiplier: number) => {
      const ts = await ampl.totalSupply();
      const multiplierGranularity = 1000;
      const newTs = ts
        .mul(BigNumber.from(multiplier * multiplierGranularity))
        .div(BigNumber.from(multiplierGranularity));
      await ampl.rebase(1, newTs.sub(ts));
    };

    const mint = async (to: string, amount: BigNumberish) => {
      await ampl.connect(amplOwner).transfer(to, amount);
    };

    return {
      bond,
      bondFactory,
      ampl,
      tranches: trancheContracts,
      userA,
      userB,
      userC,
      admin,
      amplOwner,
      signers: signers.slice(3),
      maturityDate,
      rebase,
      mint,
    };
  };

  const fixture = async () => await setupTestContext([200, 300, 500]);
  const getFixture = (tranches: number[]): Fixture<AmplTestContext> => {
    // in order for fixtures to actually save time, have to use the same instance for each run
    // so can't dynamically generate every time unless necessary
    if (_.isEqual(tranches, [200, 300, 500])) {
      return fixture;
    } else {
      return async () => await setupTestContext(tranches);
    }
  };

  it("should successfully deposit collateral and mint tranche tokens", async () => {
    const trancheValues = [200, 300, 500];
    const { bond, tranches, ampl, userA, userB, userC, admin, mint, rebase } = await loadFixture(
      getFixture(trancheValues),
    );

    // Mint 1234 AMPL to userA
    await mint(await userA.getAddress(), ampleParse("1234"));
    // Mint 5678 AMPL to userC
    await mint(await userC.getAddress(), ampleParse("5678"));

    // Balance Checks, userA: 0, userB: ??, userC: 0, admin: 0, bond: 0
    expect(await ampl.balanceOf(await userA.getAddress())).to.equal(ampleParse("1234"));
    expect(await ampl.balanceOf(await userB.getAddress())).to.equal(ampleParse("0"));
    expect(await ampl.balanceOf(await userC.getAddress())).to.equal(ampleParse("5678"));
    expect(await ampl.balanceOf(await admin.getAddress())).to.equal(ampleParse("0"));
    expect(await ampl.balanceOf(bond.address)).to.equal(ampleParse("0"));

    // userA deposits entire AMPL balance
    await ampl.connect(userA).approve(bond.address, await ampl.connect(userA).balanceOf(await userA.getAddress()));
    await bond.connect(userA).deposit(await ampl.connect(userA).balanceOf(await userA.getAddress()));

    // Rebase x1/2
    await rebase(0.5);

    // userB transfers extraneous 5678.9023 AMPL
    await mint(await userB.getAddress(), ampleParse("9012.3456"));
    await ampl.connect(userB).transfer(bond.address, ampleParse("9012.3456"));

    // Rebase x8
    await rebase(8);

    // userC deposits entire AMPL balance
    await ampl.connect(userC).approve(bond.address, await ampl.connect(userC).balanceOf(await userC.getAddress()));
    await bond.connect(userC).deposit(await ampl.connect(userC).balanceOf(await userC.getAddress()));

    // Reabse x1/4
    await rebase(0.25);

    // userB transfers extraneous 7890.1234 AMPL
    await mint(await userB.getAddress(), ampleParse("7890.1234"));
    await ampl.connect(userB).transfer(bond.address, ampleParse("7890.1234"));

    // userA early-redeems entire a,b,z tranche balance
    const aAmount = await tranches[0].connect(userA).balanceOf(await userA.getAddress());
    const bAmount = await tranches[1].connect(userA).balanceOf(await userA.getAddress());
    const zAmount = await tranches[2].connect(userA).balanceOf(await userA.getAddress());
    await bond.connect(userA).redeem([aAmount, bAmount, zAmount]);

    // Bond matures
    await bond.connect(admin).mature();

    // userB transfers extraneous 5678.9123 AMPL (this is expected to be stuck in the bond contract)
    await mint(await userB.getAddress(), ampleParse("5678.9123"));
    await ampl.connect(userB).transfer(bond.address, ampleParse("5678.9123"));

    // userC mature redeems entire tranche balance
    for (let i = 0; i < tranches.length; i++) {
      const tranche = tranches[i];
      const trancheValue = await tranche.connect(userC).balanceOf(await userC.getAddress());
      await expect(bond.connect(userC).redeemMature(tranche.address, trancheValue));
    }

    // Rounded precision to be expected
    const adminAmount = ampleParse("9012.3456").mul(2).add(ampleParse("7890.1234"));
    // Balance Checks, userA: 1234, userB: ??, userC: 5678, admin: >0, bond: 5678.9123
    expect(await ampl.balanceOf(await userA.getAddress())).to.equal(ampleParse("1234"));
    expect(await ampl.balanceOf(await userB.getAddress())).to.equal(ampleParse("0"));
    expect(await ampl.balanceOf(await userC.getAddress())).to.equal(ampleParse("5678"));
    expectEqWithEpsilon(await ampl.balanceOf(await admin.getAddress()), adminAmount, 1);
    expect(await ampl.balanceOf(bond.address)).to.equal(ampleParse("5678.9123"));
  });
});
