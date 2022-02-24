import { expect } from "chai";
import hre, { waffle } from "hardhat";
import { BigNumber, Signer } from "ethers";
import { deploy } from "./utils/contracts";
const { loadFixture } = waffle;

import { MockERC20, MockERC20CustomDecimals, Tranche, TrancheFactory } from "../typechain";

interface TestContext {
  tranche: Tranche;
  trancheFactory: TrancheFactory;
  mockCollateralToken: MockERC20;
  user: Signer;
  other: Signer;
  signers: Signer[];
}

describe("Tranche Token", () => {
  /**
   * Sets up a test context, deploying new contracts and returning them for use in a test
   */
  const setupTestContext = async (collateralTokenDecimals: number = 18): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();

    const trancheImplementation = <Tranche>await deploy("Tranche", signers[0], []);
    const trancheFactory = <TrancheFactory>await deploy("TrancheFactory", signers[0], [trancheImplementation.address]);

    const mockCollateralToken = <MockERC20CustomDecimals>(
      await deploy("MockERC20CustomDecimals", signers[0], ["Mock ERC20", "MOCK", collateralTokenDecimals])
    );
    const tx = await trancheFactory
      .connect(signers[0])
      .createTranche("Tranche", "TRANCHE", mockCollateralToken.address);
    const receipt = await tx.wait();

    let tranche;
    if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
      tranche = <Tranche>await hre.ethers.getContractAt("Tranche", receipt.events[0].args.newTrancheAddress);
    } else {
      throw new Error("Unable to create new tranche");
    }

    return {
      tranche,
      trancheFactory,
      mockCollateralToken,
      user: signers[0],
      other: signers[1],
      signers: signers.slice(2),
    };
  };

  const fixture = async () => {
    return await setupTestContext(18);
  };

  describe("Initialization", function () {
    it("should successfully initialize a tranche token", async () => {
      const { tranche, mockCollateralToken, user } = await loadFixture(fixture);
      expect(await tranche.collateralToken()).to.equal(mockCollateralToken.address);
      expect(await tranche.name()).to.equal("Tranche");
      expect(await tranche.symbol()).to.equal("TRANCHE");
      expect(await tranche.decimals()).to.equal(18);
      expect(await tranche.bond()).to.equal(await user.getAddress());
    });

    it("should fail to initialize with zero address collateralToken", async () => {
      const { trancheFactory, user } = await loadFixture(fixture);
      await expect(
        trancheFactory.connect(user).createTranche("Tranche", "TRANCHE", hre.ethers.constants.AddressZero),
      ).to.be.revertedWith("Tranche: invalid collateralToken address");
    });

    it("should take the number of decimals from the collateral token", async () => {
      const { tranche, user, mockCollateralToken } = await loadFixture(async () => await setupTestContext(8));

      expect(await tranche.collateralToken()).to.equal(mockCollateralToken.address);
      expect(await tranche.name()).to.equal("Tranche");
      expect(await tranche.symbol()).to.equal("TRANCHE");
      expect(await tranche.decimals()).to.equal(8);
      expect(await tranche.bond()).to.equal(await user.getAddress());
    });
  });

  describe("Mint", function () {
    it("should successfully mint tokens", async () => {
      const { tranche, user, other } = await loadFixture(fixture);
      const initialBalance = await tranche.balanceOf(await other.getAddress());
      const amount = hre.ethers.utils.parseEther("100");

      await expect(tranche.connect(user).mint(await other.getAddress(), amount))
        .to.emit(tranche, "Transfer")
        .withArgs(hre.ethers.constants.AddressZero, await other.getAddress(), amount);

      const endingBalance = await tranche.balanceOf(await other.getAddress());
      expect(endingBalance.sub(initialBalance)).to.equal(amount);
    });

    it("should fail to mint tokens from non-bond", async () => {
      const { tranche, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");

      await expect(tranche.connect(other).mint(await other.getAddress(), amount)).to.be.revertedWith(
        "Ownable: caller is not the bond",
      );
    });
  });

  describe("Burn", function () {
    it("should successfully burn tokens", async () => {
      const { tranche, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await tranche.connect(user).mint(await other.getAddress(), amount);
      const initialBalance = await tranche.balanceOf(await other.getAddress());

      await expect(tranche.connect(user).burn(await other.getAddress(), amount.div(2)))
        .to.emit(tranche, "Transfer")
        .withArgs(await other.getAddress(), hre.ethers.constants.AddressZero, amount.div(2));

      const endingBalance = await tranche.balanceOf(await other.getAddress());
      expect(initialBalance.sub(endingBalance)).to.equal(amount.div(2));
    });

    it("should successfully burn full balance of tokens", async () => {
      const { tranche, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await tranche.connect(user).mint(await other.getAddress(), amount);

      const initialBalance = await tranche.balanceOf(await other.getAddress());
      await expect(tranche.connect(user).burn(await other.getAddress(), initialBalance))
        .to.emit(tranche, "Transfer")
        .withArgs(await other.getAddress(), hre.ethers.constants.AddressZero, initialBalance);

      const endingBalance = await tranche.balanceOf(await other.getAddress());
      expect(endingBalance).to.equal(BigNumber.from(0));
    });

    it("should fail to burn more than balance", async () => {
      const { tranche, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await tranche.connect(user).mint(await other.getAddress(), amount);
      const initialBalance = await tranche.balanceOf(await other.getAddress());

      await expect(tranche.connect(user).burn(await other.getAddress(), initialBalance.mul(2))).to.be.revertedWith(
        "ERC20: burn amount exceeds balance",
      );
    });

    it("should fail to burn tokens from non-bond", async () => {
      const { tranche, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await tranche.connect(user).mint(await other.getAddress(), amount);

      await expect(tranche.connect(other).burn(await other.getAddress(), amount)).to.be.revertedWith(
        "Ownable: caller is not the bond",
      );
    });
  });

  describe("Redeem", function () {
    it("should successfully redeem tokens", async () => {
      const { tranche, mockCollateralToken, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await tranche.connect(user).mint(await other.getAddress(), amount);
      await mockCollateralToken.mint(tranche.address, amount);
      const initialBalance = await tranche.balanceOf(await other.getAddress());
      const initialcollateralBalance = await mockCollateralToken.balanceOf(await other.getAddress());

      await expect(tranche.connect(user).redeem(await other.getAddress(), await other.getAddress(), amount.div(2)))
        .to.emit(tranche, "Transfer")
        .withArgs(await other.getAddress(), hre.ethers.constants.AddressZero, amount.div(2));

      const endingBalance = await tranche.balanceOf(await other.getAddress());
      const endingCollateralBalance = await mockCollateralToken.balanceOf(await other.getAddress());
      expect(initialBalance.sub(endingBalance)).to.equal(amount.div(2));
      expect(endingCollateralBalance.sub(initialcollateralBalance)).to.equal(amount.div(2));
      expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(amount.div(2));
    });

    it("should successfully redeem full balance of tokens", async () => {
      const { tranche, mockCollateralToken, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await tranche.connect(user).mint(await other.getAddress(), amount);
      await mockCollateralToken.mint(tranche.address, amount);

      const initialBalance = await tranche.balanceOf(await other.getAddress());
      const initialcollateralBalance = await mockCollateralToken.balanceOf(await other.getAddress());
      await expect(tranche.connect(user).redeem(await other.getAddress(), await other.getAddress(), initialBalance))
        .to.emit(tranche, "Transfer")
        .withArgs(await other.getAddress(), hre.ethers.constants.AddressZero, initialBalance);

      const endingBalance = await tranche.balanceOf(await other.getAddress());
      const endingCollateralBalance = await mockCollateralToken.balanceOf(await other.getAddress());
      expect(endingBalance).to.equal(BigNumber.from(0));
      expect(endingCollateralBalance.sub(initialcollateralBalance)).to.equal(amount);
      expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(BigNumber.from(0));
    });

    it("should successfully redeem full balance of tokens with differing collateral balance", async () => {
      const { tranche, mockCollateralToken, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await tranche.connect(user).mint(await other.getAddress(), amount);
      await mockCollateralToken.mint(tranche.address, amount.mul(2));

      const initialBalance = await tranche.balanceOf(await other.getAddress());
      const initialcollateralBalance = await mockCollateralToken.balanceOf(await other.getAddress());
      await expect(tranche.connect(user).redeem(await other.getAddress(), await other.getAddress(), initialBalance))
        .to.emit(tranche, "Transfer")
        .withArgs(await other.getAddress(), hre.ethers.constants.AddressZero, initialBalance);

      const endingBalance = await tranche.balanceOf(await other.getAddress());
      const endingCollateralBalance = await mockCollateralToken.balanceOf(await other.getAddress());
      expect(endingBalance).to.equal(BigNumber.from(0));
      expect(endingCollateralBalance.sub(initialcollateralBalance)).to.equal(amount.mul(2));
      expect(await mockCollateralToken.balanceOf(tranche.address)).to.equal(BigNumber.from(0));
    });

    it("should fail to redeem more than balance", async () => {
      const { tranche, mockCollateralToken, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await tranche.connect(user).mint(await other.getAddress(), amount);
      await mockCollateralToken.mint(tranche.address, amount.mul(2));
      const initialBalance = await tranche.balanceOf(await other.getAddress());

      await expect(
        tranche.connect(user).redeem(await other.getAddress(), await other.getAddress(), initialBalance.mul(2)),
      ).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });

    it("should fail to redeem tokens from non-bond", async () => {
      const { tranche, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.utils.parseEther("100");
      await tranche.connect(user).mint(await other.getAddress(), amount);

      await expect(
        tranche.connect(other).redeem(await other.getAddress(), await other.getAddress(), amount),
      ).to.be.revertedWith("Ownable: caller is not the bond");
    });

    it("should fail to redeem tokens with overflow", async () => {
      const { mockCollateralToken, tranche, user, other } = await loadFixture(fixture);
      const amount = hre.ethers.constants.MaxUint256;
      await tranche.connect(user).mint(await other.getAddress(), amount);
      await mockCollateralToken.mint(tranche.address, amount);

      await expect(tranche.connect(user).redeem(await other.getAddress(), await other.getAddress(), amount)).to.be
        .reverted;
    });
  });
});
