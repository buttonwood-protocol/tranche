import { expect } from "chai";
import hre from "hardhat";
import { Signer } from "ethers";
import { deploy } from "./utils/contracts";
import { BlockchainTime } from "./utils/time";
import { ZERO_ADDRESS } from "./utils/erc20";

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
  const setupTestContext = async (tranches: number[]): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();
    const [user, other, admin] = signers;

    const trancheImplementation = <Tranche>await deploy("Tranche", admin, []);
    const trancheFactory = <TrancheFactory>await deploy("TrancheFactory", admin, [trancheImplementation.address]);

    const bondImplementation = <BondController>await deploy("BondController", admin, []);
    const bondFactory = <BondFactory>(
      await deploy("BondFactory", admin, [bondImplementation.address, trancheFactory.address])
    );

    const mockCollateralToken = <MockERC20>await deploy("MockERC20", admin, ["Mock ERC20", "MOCK"]);
    const tx = await bondFactory
      .connect(admin)
      .createBond(mockCollateralToken.address, tranches, await time.secondsFromNow(10000));
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
      bondFactory,
      mockCollateralToken,
      tranches: trancheContracts,
      user,
      other,
      admin,
      signers: signers.slice(3),
    };
  };

  describe("Initialization", function () {
    it("should successfully initialize a tranche bond", async () => {
      const { bond, tranches, mockCollateralToken, admin } = await setupTestContext([100, 200, 200, 500]);
      expect(await bond.collateralToken()).to.equal(mockCollateralToken.address);
      // ensure user has admin permissions
      expect(await bond.hasRole(hre.ethers.constants.HashZero, await admin.getAddress())).to.be.true;
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
      const tranches = [100, 200, 200, 500];
      const { bondFactory, admin } = await setupTestContext(tranches);
      await expect(
        bondFactory
          .connect(admin)
          .createBond(hre.ethers.constants.AddressZero, tranches, await time.secondsFromNow(10000)),
      ).to.be.revertedWith("BondController: invalid collateralToken address");
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
      const maturityDate = await time.secondsFromNow(10000);
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
      expect(gasUsed.toString()).to.equal("910463");
    });
  });

  describe("Deposit", function () {
    it("should successfully deposit collateral and mint tranche tokens", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, tranches, mockCollateralToken, user } = await setupTestContext(trancheValues);

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(amount))
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), bond.address, amount)
        .to.emit(bond, "Deposit")
        .withArgs(await user.getAddress(), amount);

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
      const trancheValues = [100, 200, 200, 500];
      const { bond, tranches, mockCollateralToken, user, other } = await setupTestContext(trancheValues);

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
        .withArgs(await other.getAddress(), amount);

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
      const trancheValues = [100, 200, 200, 500];
      const { bond, tranches, mockCollateralToken, user, other } = await setupTestContext(trancheValues);

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
        .withArgs(await other.getAddress(), amount);

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
      const trancheValues = [100, 200, 200, 500];
      const { bond, tranches, mockCollateralToken, user, other } = await setupTestContext(trancheValues);

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
        .withArgs(await other.getAddress(), amount);

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
      const trancheValues = [100, 200, 200, 500];
      const { bond, mockCollateralToken, user } = await setupTestContext(trancheValues);

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(0)).to.be.revertedWith("BondController: invalid amount");
    });

    it("should fail to deposit small collateral amount for first deposit", async () => {
      const trancheValues = [100, 200, 200, 500];
      const { bond, mockCollateralToken, user } = await setupTestContext(trancheValues);

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
      const trancheValues = [100, 200, 200, 500];
      const { bond, mockCollateralToken, user } = await setupTestContext(trancheValues);

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      await expect(bond.connect(user).deposit(parse("1"))).to.not.be.reverted;
      await expect(bond.connect(user).deposit(100)).to.not.be.reverted;
    });

    it("should fail to deposit collateral if not approved", async () => {
      const trancheValues = [100, 200, 200, 500];
      const { bond, mockCollateralToken, user } = await setupTestContext(trancheValues);

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);

      await expect(bond.connect(user).deposit(amount)).to.be.revertedWith(
        "revert TransferHelper::transferFrom: transferFrom failed",
      );
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const trancheValues = [200, 300, 500];
      const { bond, mockCollateralToken, user } = await setupTestContext(trancheValues);

      const amount = parse("1000");
      await mockCollateralToken.mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(bond.address, amount);

      const tx = await bond.connect(user).deposit(amount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("211592");
    });
  });

  describe("Mature", function () {
    const setup = async (trancheValues = [100, 200, 200, 500]) => {
      const { bond, tranches, mockCollateralToken, user, admin } = await setupTestContext(trancheValues);

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
        .withArgs(await admin.getAddress);

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
        .withArgs(await admin.getAddress);

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
        .withArgs(await admin.getAddress);

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
        .withArgs(await admin.getAddress);

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
      expect(gasUsed.toString()).to.equal("174959");
    });
  });

  describe("redeemMature", async () => {
    const setup = async (trancheValues = [100, 200, 200, 500]) => {
      const { bond, tranches, mockCollateralToken, user, admin } = await setupTestContext(trancheValues);

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
      const { bond, tranches, mockCollateralToken, user } = await setupTestContext(trancheValues);

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
      expect(gasUsed.toString()).to.equal("44161");
    });
  });

  describe("redeem", async () => {
    const setup = async (trancheValues = [100, 200, 200, 500]) => {
      const { bond, tranches, mockCollateralToken, user, admin } = await setupTestContext(trancheValues);

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

      await expect(bond.connect(user).redeem([100, 200, 200, 500])).to.be.revertedWith(
        "BondController: Bond is already mature",
      );
    });

    it("should fail to redeem with invalid redeem amounts", async () => {
      const { bond, user } = await setup();

      await expect(bond.connect(user).redeem([100, 200])).to.be.revertedWith("BondController: Invalid redeem amounts");
      await expect(bond.connect(user).redeem([100, 200, 200, 500, 100])).to.be.revertedWith(
        "BondController: Invalid redeem amounts",
      );
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
      expect(gasUsed.toString()).to.equal("66757");
    });
  });
});
