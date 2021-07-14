import { expect } from "chai";
import hre from "hardhat";
import { Signer } from "ethers";
import { BlockchainTime } from "./utils/time";
import { deploy } from "./utils/contracts";

import {
  MockERC20,
  MockSwapRouter,
  Tranche,
  TrancheFactory,
  BondController,
  BondFactory,
  UniV3LoanRouter,
} from "../typechain";

interface TestContext {
  router: UniV3LoanRouter;
  mockCollateralToken: MockERC20;
  mockCashToken: MockERC20;
  bond: BondController;
  tranches: Tranche[];
  user: Signer;
  other: Signer;
  signers: Signer[];
}

const time = new BlockchainTime();

describe("Uniswap V3 Loan Router", () => {
  /**
   * Sets up a test context, deploying new contracts and returning them for use in a test
   */
  const setupTestContext = async (): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();
    const [user, other, admin] = signers;

    const mockSwapRouter = <MockSwapRouter>await deploy("MockSwapRouter", signers[0], []);
    const router = <UniV3LoanRouter>await deploy("UniV3LoanRouter", signers[0], [mockSwapRouter.address]);

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

    return {
      router,
      mockCollateralToken,
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
      const { router, tranches, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(router.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("50");
      await expect(
        router.connect(user).borrowMax(amount, bond.address, mockCashToken.address, minOutput, { gasLimit: 9500000 }),
      )
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), router.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(router.address, bond.address, amount)
        .to.emit(mockCashToken, "Transfer")
        .withArgs(router.address, await user.getAddress(), minOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).gte(minOutput)).to.be.true;

      for (const tranche of tranches.slice(0, -1)) {
        expect((await tranche.balanceOf(await user.getAddress())).eq(0)).to.be.true;
      }

      expect(
        (await tranches[tranches.length - 1].balanceOf(await user.getAddress())).eq(hre.ethers.utils.parseEther("50")),
      ).to.be.true;
    });

    it("should fail if not approved", async () => {
      const { router, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      await expect(
        router.connect(user).borrowMax(amount, bond.address, mockCashToken.address, hre.ethers.utils.parseEther("50"), {
          gasLimit: 9500000,
        }),
      ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    });

    it("should fail if more than balance", async () => {
      const { router, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount.div(2));
      await mockCollateralToken.connect(user).approve(router.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      await expect(
        router.connect(user).borrowMax(amount, bond.address, mockCashToken.address, hre.ethers.utils.parseEther("50"), {
          gasLimit: 9500000,
        }),
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should fail if not enough input", async () => {
      const { router, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("80");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(router.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      await expect(
        router.connect(user).borrowMax(amount, bond.address, mockCashToken.address, hre.ethers.utils.parseEther("50"), {
          gasLimit: 9500000,
        }),
      ).to.be.revertedWith("UniV3LoanRouter: Insufficient output");
    });
  });

  describe("borrow", function () {
    it("should successfully borrow", async () => {
      const { router, tranches, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(router.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10"), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      )
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(await user.getAddress(), router.address, amount)
        .to.emit(mockCollateralToken, "Transfer")
        .withArgs(router.address, bond.address, amount)
        .to.emit(mockCashToken, "Transfer")
        .withArgs(router.address, await user.getAddress(), minOutput);

      expect((await mockCashToken.balanceOf(await user.getAddress())).gte(minOutput)).to.be.true;

      const expected = [0, hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("50")];
      for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i];
        expect((await tranche.balanceOf(await user.getAddress())).eq(expected[i])).to.be.true;
      }
    });

    it("should fail if not approved", async () => {
      const { router, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10"), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    });

    it("should fail if more than balance", async () => {
      const { router, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount.div(2));
      await mockCollateralToken.connect(user).approve(router.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10"), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should fail if less than minOutput", async () => {
      const { router, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(router.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("5"), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("UniV3LoanRouter: Insufficient output");
    });

    it("should fail if too many amounts", async () => {
      const { router, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(router.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [
              hre.ethers.utils.parseEther("20"),
              hre.ethers.utils.parseEther("5"),
              hre.ethers.utils.parseEther("5"),
              hre.ethers.utils.parseEther("5"),
            ],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.revertedWith("Invalid sales");
    });

    it("should fail if not enough sales", async () => {
      const { router, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(router.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("20"), hre.ethers.utils.parseEther("10")],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.reverted;
    });

    it("should fail if sale too high", async () => {
      const { router, mockCollateralToken, mockCashToken, bond, user } = await setupTestContext();
      const amount = hre.ethers.utils.parseEther("100");
      await mockCollateralToken.connect(user).mint(await user.getAddress(), amount);
      await mockCollateralToken.connect(user).approve(router.address, amount);

      // min output of 50 because the router will sell all A (20) and B (30) tranche tokens, but keep the Z tranches
      const minOutput = hre.ethers.utils.parseEther("30");
      await expect(
        router
          .connect(user)
          .borrow(
            amount,
            bond.address,
            mockCashToken.address,
            [hre.ethers.utils.parseEther("25"), hre.ethers.utils.parseEther("5"), 0],
            minOutput,
            { gasLimit: 9500000 },
          ),
      ).to.be.reverted;
    });
  });
});
