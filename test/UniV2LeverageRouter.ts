import { expect } from "chai";
import hre, { waffle } from "hardhat";
import { Signer } from "ethers";
import { BlockchainTime } from "./utils/time";
import { deploy } from "./utils/contracts";
const { loadFixture } = waffle;

import {
  MockERC20,
  MockSwapRouter,
  MockUniV2Router,
  Tranche,
  TrancheFactory,
  BondController,
  BondFactory,
  UniV3LoanRouter,
  UniV2LeverageRouter,
} from "../typechain";

interface TestContext {
  loanRouter: UniV3LoanRouter;
  leverageRouter: UniV2LeverageRouter;
  mockCollateralToken: MockERC20;
  mockCashToken: MockERC20;
  bond: BondController;
  tranches: Tranche[];
  user: Signer;
  other: Signer;
  signers: Signer[];
}

const time = new BlockchainTime();

describe("Uniswap V2 Leverage Router", () => {
  /**
   * Sets up a test context, deploying new contracts and returning them for use in a test
   */
  const fixture = async (): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();
    const [user, other, admin] = signers;

    const mockSwapRouter = <MockSwapRouter>await deploy("MockSwapRouter", signers[0], []);
    const loanRouter = <UniV3LoanRouter>await deploy("UniV3LoanRouter", signers[0], [mockSwapRouter.address]);

    const mockUniV2Router = <MockUniV2Router>await deploy("MockUniV2Router", signers[0], []);
    const leverageRouter = <UniV2LeverageRouter>(
      await deploy("UniV2LeverageRouter", signers[0], [mockUniV2Router.address])
    );

    const mockCollateralToken = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);
    const mockCashToken = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);

    const trancheImplementation = <Tranche>await deploy("Tranche", admin, []);
    const trancheFactory = <TrancheFactory>await deploy("TrancheFactory", admin, [trancheImplementation.address]);

    const bondImplementation = <BondController>await deploy("BondController", admin, []);
    const bondFactory = <BondFactory>(
      await deploy("BondFactory", admin, [bondImplementation.address, trancheFactory.address])
    );

    const tranches = [200, 300, 500];
    let bond: BondController | undefined;
    const tx = await bondFactory
      .connect(admin)
      .createBond(mockCollateralToken.address, tranches, await time.secondsFromNow(10000));
    const receipt = await tx.wait();
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
    // load up the mock uniswap with tokens for swapping
    await mockCollateralToken.mint(mockSwapRouter.address, hre.ethers.utils.parseEther("1000000000000"));
    await mockCashToken.mint(mockSwapRouter.address, hre.ethers.utils.parseEther("1000000000000"));
    await mockCollateralToken.mint(mockUniV2Router.address, hre.ethers.utils.parseEther("1000000000000"));
    await mockCashToken.mint(mockUniV2Router.address, hre.ethers.utils.parseEther("1000000000000"));

    return {
      loanRouter,
      leverageRouter,
      mockCollateralToken,
      bond,
      tranches: trancheContracts,
      mockCashToken,
      user,
      other,
      signers: signers.slice(2),
    };
  };

  describe("lever", function () {
    it("should successfully lever 1 iteration", async () => {
      const { loanRouter, leverageRouter, tranches, mockCollateralToken, mockCashToken, bond, user } =
        await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(leverageRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      // then trade those 50 cash tokens back for 50 collateral tokens
      const minOutput = hre.ethers.utils.parseEther("50");
      await expect(
        leverageRouter
          .connect(user)
          .lever(
            amount,
            bond.address,
            loanRouter.address,
            mockCashToken.address,
            [mockCashToken.address, mockCollateralToken.address],
            1,
            minOutput,
            { gasLimit: 9500000 },
          ),
      )
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), leverageRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, loanRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(loanRouter.address, bond.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, await user.getAddress(), minOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      expect((await mockCollateralToken.balanceOf(await user.getAddress())).gte(minOutput)).to.be.true;

      for (const tranche of tranches.slice(0, -1)) {
        expect((await tranche.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      }

      expect(
        (await tranches[tranches.length - 1].balanceOf(await user.getAddress())).eq(hre.ethers.utils.parseEther("50")),
      ).to.be.true;
    });

    it("should successfully lever 2 iterations", async () => {
      const { loanRouter, leverageRouter, tranches, mockCollateralToken, mockCashToken, bond, user } =
        await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(leverageRouter.address, amount);

      // min output of 85 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      // then trade those 50 cash tokens back for 50 collateral tokens
      // then borrow against those 50 collateral tokens, netting 10 A and 15 B tranche tokens
      // then trade those 25 cash tokens back for 25 collateral tokens
      const minZTrancheOutput = hre.ethers.utils.parseEther("75");
      const minCollateralTokenOutput = hre.ethers.utils.parseEther("25");
      await expect(
        leverageRouter
          .connect(user)
          .lever(
            amount,
            bond.address,
            loanRouter.address,
            mockCashToken.address,
            [mockCashToken.address, mockCollateralToken.address],
            2,
            minZTrancheOutput,
            { gasLimit: 9500000 },
          ),
      )
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), leverageRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, loanRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(loanRouter.address, bond.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, await user.getAddress(), minCollateralTokenOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      expect((await mockCollateralToken.balanceOf(await user.getAddress())).gte(minCollateralTokenOutput)).to.be.true;

      for (const tranche of tranches.slice(0, -1)) {
        expect((await tranche.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      }

      expect((await tranches[tranches.length - 1].balanceOf(await user.getAddress())).eq(minZTrancheOutput)).to.be.true;
    });

    it("should successfully lever 3 iterations", async () => {
      const { loanRouter, leverageRouter, tranches, mockCollateralToken, mockCashToken, bond, user } =
        await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(leverageRouter.address, amount);

      // min output of 85 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      // then trade those 50 cash tokens back for 50 collateral tokens
      // then borrow against those 50 collateral tokens, netting 10 A and 15 B tranche tokens
      // then trade those 25 cash tokens back for 25 collateral tokens
      const minZTrancheOutput = hre.ethers.utils.parseEther("87.5");
      const minCollateralTokenOutput = hre.ethers.utils.parseEther("12.5");
      await expect(
        leverageRouter
          .connect(user)
          .lever(
            amount,
            bond.address,
            loanRouter.address,
            mockCashToken.address,
            [mockCashToken.address, mockCollateralToken.address],
            3,
            minZTrancheOutput,
            { gasLimit: 9500000 },
          ),
      )
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), leverageRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, loanRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(loanRouter.address, bond.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, await user.getAddress(), minCollateralTokenOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      expect((await mockCollateralToken.balanceOf(await user.getAddress())).gte(minCollateralTokenOutput)).to.be.true;

      for (const tranche of tranches.slice(0, -1)) {
        expect((await tranche.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      }

      expect((await tranches[tranches.length - 1].balanceOf(await user.getAddress())).eq(minZTrancheOutput)).to.be.true;
    });

    it("should successfully lever 4 iterations", async () => {
      const { loanRouter, leverageRouter, tranches, mockCollateralToken, mockCashToken, bond, user } =
        await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(leverageRouter.address, amount);

      // min output of 85 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      // then trade those 50 cash tokens back for 50 collateral tokens
      // then borrow against those 50 collateral tokens, netting 10 A and 15 B tranche tokens
      // then trade those 25 cash tokens back for 25 collateral tokens
      const minZTrancheOutput = hre.ethers.utils.parseEther("93.75");
      const minCollateralTokenOutput = hre.ethers.utils.parseEther("6.25");
      await expect(
        leverageRouter
          .connect(user)
          .lever(
            amount,
            bond.address,
            loanRouter.address,
            mockCashToken.address,
            [mockCashToken.address, mockCollateralToken.address],
            4,
            minZTrancheOutput,
            { gasLimit: 9500000 },
          ),
      )
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), leverageRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, loanRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(loanRouter.address, bond.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, await user.getAddress(), minCollateralTokenOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      expect((await mockCollateralToken.balanceOf(await user.getAddress())).gte(minCollateralTokenOutput)).to.be.true;

      for (const tranche of tranches.slice(0, -1)) {
        expect((await tranche.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      }

      expect((await tranches[tranches.length - 1].balanceOf(await user.getAddress())).eq(minZTrancheOutput)).to.be.true;
    });

    it("should successfully lever 5 iterations", async () => {
      const { loanRouter, leverageRouter, tranches, mockCollateralToken, mockCashToken, bond, user } =
        await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(leverageRouter.address, amount);

      // min output of 85 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      // then trade those 50 cash tokens back for 50 collateral tokens
      // then borrow against those 50 collateral tokens, netting 10 A and 15 B tranche tokens
      // then trade those 25 cash tokens back for 25 collateral tokens
      const minZTrancheOutput = hre.ethers.utils.parseEther("96.875");
      const minCollateralTokenOutput = hre.ethers.utils.parseEther("3.125");
      await expect(
        leverageRouter
          .connect(user)
          .lever(
            amount,
            bond.address,
            loanRouter.address,
            mockCashToken.address,
            [mockCashToken.address, mockCollateralToken.address],
            5,
            minZTrancheOutput,
            { gasLimit: 9500000 },
          ),
      )
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), leverageRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, loanRouter.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(loanRouter.address, bond.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(leverageRouter.address, await user.getAddress(), minCollateralTokenOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      expect((await mockCollateralToken.balanceOf(await user.getAddress())).gte(minCollateralTokenOutput)).to.be.true;

      for (const tranche of tranches.slice(0, -1)) {
        expect((await tranche.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      }

      expect((await tranches[tranches.length - 1].balanceOf(await user.getAddress())).eq(minZTrancheOutput)).to.be.true;
    });

    it("should fail with invalid currency", async () => {
      const { loanRouter, leverageRouter, mockCollateralToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(leverageRouter.address, amount);

      // min output of 85 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      // then trade those 50 cash tokens back for 50 collateral tokens
      // then borrow against those 50 collateral tokens, netting 10 A and 15 B tranche tokens
      // then trade those 25 cash tokens back for 25 collateral tokens
      const minZTrancheOutput = hre.ethers.utils.parseEther("75");
      await expect(
        leverageRouter
          .connect(user)
          .lever(
            amount,
            bond.address,
            loanRouter.address,
            mockCollateralToken.address,
            [mockCashToken.address, mockCollateralToken.address],
            2,
            minZTrancheOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("LeverageRouter: Invalid currency");
    });

    it("should fail with insufficient output", async () => {
      const { loanRouter, leverageRouter, mockCollateralToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(leverageRouter.address, amount);

      // min output of 85 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      // then trade those 50 cash tokens back for 50 collateral tokens
      // then borrow against those 50 collateral tokens, netting 10 A and 15 B tranche tokens
      // then trade those 25 cash tokens back for 25 collateral tokens
      const minZTrancheOutput = hre.ethers.utils.parseEther("76");
      await expect(
        leverageRouter
          .connect(user)
          .lever(
            amount,
            bond.address,
            loanRouter.address,
            mockCashToken.address,
            [mockCashToken.address, mockCollateralToken.address],
            2,
            minZTrancheOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("LeverageRouter: Insufficient output");
    });
  });
});
