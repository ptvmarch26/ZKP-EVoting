const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("🚀 Deploying contracts with account:");
  console.log("   ", deployer.address);

  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("💰 Balance:", hre.ethers.formatEther(balance), "ETH");

  const EVoting = await hre.ethers.getContractFactory("E_Voting");
  const evoting = await EVoting.deploy();

  await evoting.waitForDeployment();

  console.log("✅ E_Voting deployed to:");
  console.log("   ", await evoting.getAddress());

  const Tally = await hre.ethers.getContractFactory("TallyVerifierOnChain");
  const tally = await Tally.deploy();

  await tally.waitForDeployment();

  console.log("✅ Tally deployed to:");
  console.log("   ", await tally.getAddress());
}

main().catch((error) => {
  console.error("❌ Deploy failed:");
  console.error(error);
  process.exit(1);
});
