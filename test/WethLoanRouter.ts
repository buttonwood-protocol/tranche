import { expect } from "chai";
import hre, { waffle } from "hardhat";
import { Signer } from "ethers";
import { BlockchainTime } from "./utils/time";
import { deploy } from "./utils/contracts";
const { loadFixture } = waffle;

import {
  MockERC20,
  MockButtonWrapper,
  MockSwapRouter,
  Tranche,
  TrancheFactory,
  BondController,
  BondFactory,
  WethLoanRouter,
  UniV3LoanRouter,
  WETH9,
  BadLoanRouter,
} from "../typechain";

interface TestContext {
  router: WethLoanRouter;
  routerWithBadLoanRouter: WethLoanRouter;
  loanRouter: UniV3LoanRouter;
  weth: WETH9;
  mockWrapperToken: MockButtonWrapper;
  bondFactory: BondFactory;
  mockCashToken: MockERC20;
  bond: BondController;
  tranches: Tranche[];
  user: Signer;
  other: Signer;
  admin: Signer;
  signers: Signer[];
}

const time = new BlockchainTime();

describe("WETH Loan Router", () => {
  /**
   * Sets up a test context, deploying new contracts and returning them for use in a test
   */
  const fixture = async (): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();
    const [user, other, admin] = signers;

    const mockSwapRouter = <MockSwapRouter>await deploy("MockSwapRouter", user, []);
    const loanRouter = <UniV3LoanRouter>await deploy("UniV3LoanRouter", admin, [mockSwapRouter.address]);
    const badLoanRouter = <BadLoanRouter>await deploy("BadLoanRouter", admin, []);

    const weth = <WETH9>await deploy("WETH9", admin, []);
    const router = <WethLoanRouter>await deploy("WethLoanRouter", admin, [loanRouter.address, weth.address]);
    const routerWithBadLoanRouter = <WethLoanRouter>await deploy("WethLoanRouter", admin, [badLoanRouter.address, weth.address]);

    const mockWrapperToken = <MockButtonWrapper>(
      await deploy("MockButtonWrapper", admin, [weth.address, "Mock Button WETH", "MOCK-BTN-WETH"])
    );
    const mockCashToken = <MockERC20>await deploy("MockERC20", admin, ["Mock ERC20", "MOCK-USDT"]);

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
      .createBond(mockWrapperToken.address, tranches, await time.secondsFromNow(10000));
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
    // ToDo: @mark-toda Why do the wrapper-tests in the other loan routers do this with the collateral and not wrapper token?
    // await mockCollateralToken.mint(mockSwapRouter.address, hre.ethers.utils.parseEther("1000000000000"));
    await mockCashToken.mint(mockSwapRouter.address, hre.ethers.utils.parseEther("1000000000000"));

    return {
      router,
      routerWithBadLoanRouter,
      loanRouter,
      weth,
      mockWrapperToken,
      bond,
      bondFactory,
      tranches: trancheContracts,
      mockCashToken,
      user,
      other,
      admin,
      signers: signers.slice(2),
    };
  };

  describe("wrapAndBorrowMax", function () {
    it("should successfully wrap and borrow max", async () => {
      const { router, loanRouter, tranches, weth, mockWrapperToken, mockCashToken, bond, user } = await loadFixture(
        fixture,
      );
      const startingBalance = await user.getBalance();
      const amount = hre.ethers.utils.parseEther("100");

      // Note: the mock AMM swaps at a 1:1 ratio
      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("50");

      await expect(
        router
          .connect(user)
          .wrapAndBorrowMax(bond.address, mockCashToken.address, minOutput, { value: amount, gasLimit: 9500000 }),
      )
        // // Note: the mock wrapper wraps at a 1:1 ratio, thus the wrapped output is equal to the input
        .to.emit(weth, "Transfer")
        .withArgs(router.address, loanRouter.address, amount)
        .to.emit(mockWrapperToken, "Transfer")
        .withArgs(loanRouter.address, bond.address, amount)
        .to.emit(mockCashToken, "Transfer")
        .withArgs(loanRouter.address, router.address, minOutput)
        .to.emit(mockCashToken, "Transfer")
        .withArgs(router.address, await user.getAddress(), minOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).gte(minOutput)).to.be.true;

      for (const tranche of tranches.slice(0, -1)) {
        expect((await tranche.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      }

      expect(
        (await tranches[tranches.length - 1].balanceOf(await user.getAddress())).eq(hre.ethers.utils.parseEther("50")),
      ).to.be.true;

      expect(await user.getBalance()).to.lte(
        startingBalance.sub(amount),
        `User ETH balance should have decreased by at least ${amount.toString()}`,
      );
    });

    it("should fetch amountOut from a static call", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("50");
      const amountOut = await router
        .connect(user)
        .callStatic.wrapAndBorrowMax(bond.address, mockCashToken.address, minOutput, { value: amount });
      expect(minOutput).to.equal(amountOut);
    });

    it("should fail if not a wrapper token", async () => {
      const { router, mockCashToken, bondFactory, user } = await loadFixture(fixture);

      // deploy a new bond factory with a non-wrapper collateral
      let bond: BondController | undefined;
      const tx = await bondFactory.createBond(mockCashToken.address, [200, 300, 500], await time.secondsFromNow(10000));
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

      const amount = hre.ethers.utils.parseEther("100");

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      await expect(
        router.connect(user).wrapAndBorrowMax(bond.address, mockCashToken.address, hre.ethers.utils.parseEther("50"), {
          value: amount,
          gasLimit: 9500000,
        }),
      ).to.be.revertedWith(
        "Transaction reverted: function selector was not recognized and there's no fallback function",
      );
    });

    it("should fail if bond's collateral token's underlying does not match weth address", async () => {
      const { router, mockCashToken, bondFactory, user, admin } = await loadFixture(fixture);

      const mockButtonCash = <MockButtonWrapper>(
        await deploy("MockButtonWrapper", admin, [mockCashToken.address, "Mock Button USDT", "MOCK-BTN-USDT"])
      );

      const tranches = [200, 300, 500];
      let wrappedCashTokenBond: BondController | undefined;
      const tx = await bondFactory
        .connect(admin)
        .createBond(mockButtonCash.address, tranches, await time.secondsFromNow(10000));
      const receipt = await tx.wait();
      if (receipt && receipt.events) {
        for (const event of receipt.events) {
          if (event.args && event.args.newBondAddress) {
            wrappedCashTokenBond = <BondController>(
              await hre.ethers.getContractAt("BondController", event.args.newBondAddress)
            );
          }
        }
      } else {
        throw new Error("Unable to create new bond");
      }
      if (!wrappedCashTokenBond) {
        throw new Error("Unable to create new bond");
      }

      const amount = hre.ethers.utils.parseEther("100");

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      await expect(
        router
          .connect(user)
          .wrapAndBorrowMax(wrappedCashTokenBond.address, mockCashToken.address, hre.ethers.utils.parseEther("50"), {
            value: amount,
            gasLimit: 9500000,
          }),
      ).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("should fail if no eth sent", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("0");

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      await expect(
        router.connect(user).wrapAndBorrowMax(bond.address, mockCashToken.address, hre.ethers.utils.parseEther("50"), {
          value: amount,
          gasLimit: 9500000,
        }),
      ).to.be.revertedWith("ButtonTokenWethRouter: No ETH supplied");
    });

    it("should fail if not enough input", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("80");

      // min output of 50 will not be enough because the router will sell all A (16) and B (24) tranche tokens, which is not enough
      await expect(
        router.connect(user).wrapAndBorrowMax(bond.address, mockCashToken.address, hre.ethers.utils.parseEther("50"), {
          value: amount,
          gasLimit: 9500000,
        }),
      ).to.be.revertedWith("LoanRouter: Insufficient output");
    });
  });

  it("WethLoanRouter should fail on insufficient output even if LoanRouter does not", async () => {
    const { routerWithBadLoanRouter, mockCashToken, bond, user } = await loadFixture(fixture);
    const amount = hre.ethers.utils.parseEther("100");

    // min output of 50 will not be enough because the badLoanRouter will output 0
    await expect(
      routerWithBadLoanRouter.connect(user).wrapAndBorrowMax(bond.address, mockCashToken.address, hre.ethers.utils.parseEther("50"), {
        value: amount,
        gasLimit: 9500000,
      }),
    ).to.be.revertedWith("WethLoanRouter: Insufficient output");
  });

  describe("wrapAndBorrow", function () {
    it("should successfully wrap and borrow", async () => {
      const { router, loanRouter, tranches, weth, mockWrapperToken, mockCashToken, bond, user } = await loadFixture(
        fixture,
      );
      const startingBalance = await user.getBalance();
      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 because the router will sell all A (20) and only B (10) tranche tokens, but keep the remaining B (20) tranche tokens and all the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .wrapAndBorrow(
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10"), 0],
            minOutput,
            { value: amount, gasLimit: 9500000 },
          ),
      )
        .to.emit(weth, "Transfer")
        .withArgs(router.address, loanRouter.address, amount)
        .to.emit(mockWrapperToken, "Transfer")
        .withArgs(loanRouter.address, bond.address, amount)
        .to.emit(mockCashToken, "Transfer")
        .withArgs(loanRouter.address, router.address, minOutput)
        .to.emit(mockCashToken, "Transfer")
        .withArgs(router.address, await user.getAddress(), minOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).gte(minOutput)).to.be.true;

      const expected = [0, hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("50")];
      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        expect((await tranche.balanceOf(await user.getAddress())).eq(expected[i])).to.be.true;
      }

      expect(await user.getBalance()).to.lte(
        startingBalance.sub(amount),
        `User ETH balance should have decreased by at least ${amount.toString()}`,
      );
    });

    it("should fetch amountOut from a static call", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 because the router will sell all A (20) and only B (10) tranche tokens, but keep the remaining B (20) tranche tokens and all the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      const amountOut = await router
        .connect(user)
        .callStatic.wrapAndBorrow(
          bond.address,
          mockCashToken.address,
          [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10"), 0],
          minOutput,
          { value: amount, gasLimit: 9500000 },
        );
      expect(minOutput).to.equal(amountOut);
    });

    it("should fail if not a wrapper token", async () => {
      const { router, mockCashToken, bondFactory, user } = await loadFixture(fixture);

      // deploy a new bond factory with a non-wrapper collateral
      let bond: BondController | undefined;
      const tx = await bondFactory.createBond(mockCashToken.address, [200, 300, 500], await time.secondsFromNow(10000));
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

      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 because the router will sell all A (20) and only B (10) tranche tokens, but keep the remaining B (20) tranche tokens and all the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .wrapAndBorrow(
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10"), 0],
            minOutput,
            {
              value: amount,
              gasLimit: 9500000,
            },
          ),
      ).to.be.revertedWith(
        "Transaction reverted: function selector was not recognized and there's no fallback function",
      );
    });

    it("should fail if bond's collateral token's underlying does not match weth address", async () => {
      const { router, mockCashToken, bondFactory, user, admin } = await loadFixture(fixture);

      const mockButtonCash = <MockButtonWrapper>(
        await deploy("MockButtonWrapper", admin, [mockCashToken.address, "Mock Button USDT", "MOCK-BTN-USDT"])
      );

      const tranches = [200, 300, 500];
      let wrappedCashTokenBond: BondController | undefined;
      const tx = await bondFactory
        .connect(admin)
        .createBond(mockButtonCash.address, tranches, await time.secondsFromNow(10000));
      const receipt = await tx.wait();
      if (receipt && receipt.events) {
        for (const event of receipt.events) {
          if (event.args && event.args.newBondAddress) {
            wrappedCashTokenBond = <BondController>(
              await hre.ethers.getContractAt("BondController", event.args.newBondAddress)
            );
          }
        }
      } else {
        throw new Error("Unable to create new bond");
      }
      if (!wrappedCashTokenBond) {
        throw new Error("Unable to create new bond");
      }

      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 because the router will sell all A (20) and only B (10) tranche tokens, but keep the remaining B (20) tranche tokens and all the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .wrapAndBorrow(
            wrappedCashTokenBond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10"), 0],
            minOutput,
            {
              value: amount,
              gasLimit: 9500000,
            },
          ),
      ).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("should fail if no eth sent", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("0");

      // min output of 30 because the router will sell all A (20) and only B (10) tranche tokens, but keep the remaining B (20) tranche tokens and all the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .wrapAndBorrow(
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10"), 0],
            minOutput,
            {
              value: amount,
              gasLimit: 9500000,
            },
          ),
      ).to.be.revertedWith("ButtonTokenWethRouter: No ETH supplied");
    });

    it("should fail if less than minOutput", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 will not be enough because loanRouter is only selling 20 A, and 5 B tokens for 25 USDT
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .wrapAndBorrow(
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("5"), 0],
            minOutput,
            { value: amount, gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("LoanRouter: Insufficient output");
    });

    it("WethLoanRouter should fail on insufficient output even if LoanRouter does not", async () => {
      const { routerWithBadLoanRouter, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 will not be enough because the badLoanRouter will output 0
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        routerWithBadLoanRouter
          .connect(user)
          .wrapAndBorrow(
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("5"), 0],
            minOutput,
            { value: amount, gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("WethLoanRouter: Insufficient output");
    });

    it("should fail if too many amounts", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 because the router will sell all A (20) and only B (10) tranche tokens, but keep the remaining B (20) tranche tokens and all the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .wrapAndBorrow(
            bond.address,
            mockCashToken.address,
            [
              hre.ethers.utils.parseEther("20"),
              hre.ethers.utils.parseEther("5"),
              hre.ethers.utils.parseEther("5"),
              hre.ethers.utils.parseEther("5"),
            ],
            minOutput,
            { value: amount, gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("Invalid sales");
    });

    it("should fail if not enough sales", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 because the router will sell all A (20) and only B (10) tranche tokens, but keep the remaining B (20) tranche tokens and all the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .wrapAndBorrow(
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10")],
            minOutput,
            { value: amount, gasLimit: 9500000 },
          ),
      ).to.be.reverted;
    });

    it("should fail if sale too high", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 because the router will sell all A (20) and only B (10) tranche tokens, but keep the remaining B (20) tranche tokens and all the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .wrapAndBorrow(
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("25"), hre.ethers.utils.parseEther("5"), 0],
            minOutput,
            { value: amount, gasLimit: 9500000 },
          ),
      ).to.be.reverted;
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const { router, mockCashToken, bond, user } = await loadFixture(fixture);
      const startingBalance = await user.getBalance();
      const amount = hre.ethers.utils.parseEther("100");

      // min output of 30 because the router will sell all A (20) and only B (10) tranche tokens, but keep the remaining B (20) tranche tokens and all the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      const tx = await router
        .connect(user)
        .wrapAndBorrow(
          bond.address,
          mockCashToken.address,
          [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10"), 0],
          minOutput,
          { value: amount, gasLimit: 9500000 },
        );

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("686776");
      const costOfGas = gasUsed.mul(receipt.effectiveGasPrice);
      expect(await user.getBalance()).to.eq(
        startingBalance.sub(amount).sub(costOfGas),
        "Expecting userBalance to equal startingBalance - amount - costOfGas.",
      );
    });
  });
});
