import { expect } from "chai";
import hre, { waffle, ethers } from "hardhat";
import { Signer } from "ethers";
import { BlockchainTime } from "./utils/time";
import { deploy } from "./utils/contracts";
const { loadFixture } = waffle;

import {
  MockERC20,
  MockSwapRouter,
  Tranche,
  TrancheFactory,
  BondController,
  BondFactory,
  UniV3LoanRouter,
  AutoWrapLoanRouter, IButtonToken, MockOracle, MockButtonToken,
} from "../typechain";

interface TestContext {
  autoWrapLoanRouter: AutoWrapLoanRouter;
  uniV3LoanRouter: UniV3LoanRouter;
  mockButtonToken: IButtonToken,
  mockUnderlyingToken: MockERC20;
  mockCashToken: MockERC20;
  bond: BondController;
  tranches: Tranche[];
  user: Signer;
  other: Signer;
  signers: Signer[];
}

const time = new BlockchainTime();

describe("AutoWrapLoanRouter with a Uniswap V3 Loan Router", () => {
  /**
   * Sets up a test context, deploying new contracts and returning them for use in a test
   */
  const fixture = async (): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();
    const [user, other, admin] = signers;

    const mockSwapRouter = <MockSwapRouter>await deploy("MockSwapRouter", signers[0], []);
    const uniV3LoanRouter = <UniV3LoanRouter>await deploy("UniV3LoanRouter", signers[0], [mockSwapRouter.address]);
    const autoWrapLoanRouter = <AutoWrapLoanRouter>await deploy("AutoWrapLoanRouter", signers[0], [uniV3LoanRouter.address]);

    const mockUnderlyingToken = <MockERC20>await deploy("MockERC20", signers[0], ["Mock WBTC", "WBTC"]);

    // const oracleFactory = await ethers.getContractFactory('MockOracle')
    const mockOracle = <MockOracle>await deploy("MockOracle", admin, []);
    await mockOracle.setData(hre.ethers.utils.parseEther('10'), true)

    const mockButtonToken = <MockButtonToken>await deploy("MockButtonToken", admin, []);
    mockButtonToken.initialize(mockUnderlyingToken.address, 'Button MockWTBC', 'BTN-MOCK-WBTC', mockOracle.address)

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
      .createBond(mockButtonToken.address, tranches, await time.secondsFromNow(10000));
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
    await mockUnderlyingToken.connect(admin).mint(await admin.getAddress(), hre.ethers.utils.parseEther("10000"));
    await mockUnderlyingToken.connect(admin).approve(mockButtonToken.address, hre.ethers.utils.parseEther("10000"));
    await mockButtonToken.connect(admin).mintFor(mockSwapRouter.address, hre.ethers.utils.parseEther("10000000000000"));
    await mockCashToken.connect(admin).mint(mockSwapRouter.address, hre.ethers.utils.parseEther("10000000000000"));

    return {
      autoWrapLoanRouter,
      uniV3LoanRouter,
      mockButtonToken,
      mockUnderlyingToken,
      bond,
      tranches: trancheContracts,
      mockCashToken,
      user,
      other,
      signers: signers.slice(2),
    };
  };

  describe("borrowMax", function () {
    it("should successfully borrow max", async () => {
      const { autoWrapLoanRouter, uniV3LoanRouter, tranches, mockButtonToken, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      const wrapperAmount = hre.ethers.utils.parseUnits("100", 29);

      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("50", 29);

      await expect(
        autoWrapLoanRouter.connect(user).borrowMax(amount, bond.address, mockCashToken.address, minOutput, { gasLimit: 9500000 }),
      )
        .to.emit(mockUnderlyingToken, "Transfer")
        .withArgs(await user.getAddress(), autoWrapLoanRouter.address, amount)
        .to.emit(mockUnderlyingToken, "Transfer")
        .withArgs(autoWrapLoanRouter.address, mockButtonToken.address, amount)
        .to.emit(mockButtonToken, "Transfer")
        .withArgs(ethers.constants.AddressZero, autoWrapLoanRouter.address, wrapperAmount)
        .to.emit(mockButtonToken, "Transfer")
        .withArgs(ethers.constants.AddressZero, autoWrapLoanRouter.address, wrapperAmount)
        .to.emit(mockButtonToken, "Transfer")
        .withArgs(autoWrapLoanRouter.address, uniV3LoanRouter.address, wrapperAmount)
        .to.emit(mockButtonToken, "Transfer")
        .withArgs(uniV3LoanRouter.address, bond.address, wrapperAmount)
        .to.emit(mockCashToken, "Transfer")
        .withArgs(uniV3LoanRouter.address, autoWrapLoanRouter.address, minOutput)
        .to.emit(mockCashToken, "Transfer")
        .withArgs(autoWrapLoanRouter.address, await user.getAddress(), minOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).gte(minOutput)).to.be.true;

      for (const tranche of tranches.slice(0, -1)) {
        expect((await tranche.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      }

      expect(
        (await tranches[tranches.length - 1].balanceOf(await user.getAddress())).eq(hre.ethers.utils.parseUnits("50", 29)),
      ).to.be.true;
    });

    it("should fetch amountOut from a static call", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);
      // min output of 50 (button-tokens) because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("50", 29);
      const amountOut = await autoWrapLoanRouter
        .connect(user)
        .callStatic.borrowMax(amount, bond.address, mockCashToken.address, minOutput);
      expect(minOutput).to.equal(amountOut);
    });

    it("should fail if not approved", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      await expect(
        autoWrapLoanRouter.connect(user).borrowMax(amount, bond.address, mockCashToken.address, hre.ethers.utils.parseUnits("50", 29), {
          gasLimit: 9500000,
        }),
      ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    });

    it("should fail if more than balance", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount.div(2));
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      await expect(
        autoWrapLoanRouter.connect(user).borrowMax(amount, bond.address, mockCashToken.address, hre.ethers.utils.parseUnits("50", 29), {
          gasLimit: 9500000,
        }),
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should fail if not enough input", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("80");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      await expect(
        autoWrapLoanRouter.connect(user).borrowMax(amount, bond.address, mockCashToken.address, hre.ethers.utils.parseUnits("50", 29), {
          gasLimit: 9500000,
        }),
      ).to.be.revertedWith("UniV3LoanRouter: Insufficient output");
    });
  });

  describe("borrow", function () {
    it("should successfully borrow", async () => {
      const { autoWrapLoanRouter, uniV3LoanRouter, tranches, mockUnderlyingToken, mockButtonToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("30", 29);
      await expect(
        autoWrapLoanRouter
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseUnits("20", 29), hre.ethers.utils.parseUnits("10", 29), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      )
        .to.emit(mockUnderlyingToken, "Transfer")
        .withArgs(await user.getAddress(), autoWrapLoanRouter.address, amount)
        .to.emit(mockButtonToken, "Transfer")
        .withArgs(uniV3LoanRouter.address, bond.address, hre.ethers.utils.parseUnits("100", 29))
        .to.emit(mockCashToken, "Transfer")
        .withArgs(autoWrapLoanRouter.address, await user.getAddress(), minOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).gte(minOutput)).to.be.true;

      const expected = [0, hre.ethers.utils.parseUnits("20", 29), hre.ethers.utils.parseUnits("50", 29)];
      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        expect((await tranche.balanceOf(await user.getAddress())).eq(expected[i])).to.be.true;
      }
    });

    it("should fetch amountOut from a static call", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("30", 29);
      const amountOut = await autoWrapLoanRouter
        .connect(user)
        .callStatic.borrow(
          amount,
          bond.address,
          mockCashToken.address,
          [hre.ethers.utils.parseUnits("20", 29), hre.ethers.utils.parseUnits("10", 29), 0],
          minOutput,
          { gasLimit: 9500000 },
        );
      expect(minOutput).to.equal(amountOut);
    });

    it("should fail if not approved", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("30", 29);
      await expect(
        autoWrapLoanRouter
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseUnits("20", 29), hre.ethers.utils.parseUnits("10", 29), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    });

    it("should fail if more than balance", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount.div(2));
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("30", 29);
      await expect(
        autoWrapLoanRouter
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseUnits("20", 29), hre.ethers.utils.parseUnits("10", 29), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should fail if less than minOutput", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("30", 29);
      await expect(
        autoWrapLoanRouter
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseUnits("20", 29), hre.ethers.utils.parseUnits("5", 29), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("UniV3LoanRouter: Insufficient output");
    });

    it("should fail if too many amounts", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("30", 29);
      await expect(
        autoWrapLoanRouter
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [
              hre.ethers.utils.parseUnits("20", 29),
              hre.ethers.utils.parseUnits("5", 29),
              hre.ethers.utils.parseUnits("5", 29),
              hre.ethers.utils.parseUnits("5", 29),
            ],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("Invalid sales");
    });

    it("should fail if not enough sales", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("30", 29);
      await expect(
        autoWrapLoanRouter
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseUnits("20", 29), hre.ethers.utils.parseUnits("10", 29)],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.reverted;
    });

    it("should fail if sale too high", async () => {
      const { autoWrapLoanRouter, mockUnderlyingToken, mockCashToken, bond, user } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await mockUnderlyingToken.connect(user).mint(await user.getAddress(), amount);
      await mockUnderlyingToken.connect(user).approve(autoWrapLoanRouter.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseUnits("30", 29);
      await expect(
        autoWrapLoanRouter
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseUnits("25", 29), hre.ethers.utils.parseUnits("5", 29), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.reverted;
    });
  });
});
