const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { buildPoseidon } = require("circomlibjs");
const merkleUtils = require("../utils/merkleUtils");
const { ethers } = hre;
const { getContract } = require("../configs/blockchain");
const VOTER_DB_FILE = path.join(__dirname, "../data/voter_data_for_db_10.json");

const ELECTION_ID = "ELC2024";
const ELECTION_NAME = "Demo Election";
const START_DATE = Math.floor(Date.now() / 1000);
const END_DATE = START_DATE + 7 * 24 * 3600;

// ===== MAIN =====
async function buildMerkleAndPublish() {
  console.time("⏱ build_merkle");

  const { votingContract } = await getContract();
  // 1️⃣ Load voter DB
  const voters = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
  if (!voters.length) throw new Error("No voters found");

  console.log(`📦 Loaded ${voters.length} voters`);

  // 2️⃣ Build Merkle Tree
  console.log("🧩 Building Poseidon Merkle Tree...");
  const poseidon = await buildPoseidon();

  const leaves = voters.map((v) => BigInt(v.hashed_key));
  const tree = merkleUtils.buildMerkleTree(poseidon, leaves);
  const root = merkleUtils.getMerkleRoot(tree);

  console.log("🌳 Merkle root:", root.toString());

  // 3️⃣ Generate Merkle proofs
  voters.forEach((voter, index) => {
    const { pathElements, pathIndices } = merkleUtils.getMerkleProof(
      tree,
      index,
    );

    voter.merkle_proof = {
      path_elements: pathElements.map(String),
      path_indices: pathIndices.map(String),
    };
  });

  fs.writeFileSync(VOTER_DB_FILE, JSON.stringify(voters, null, 2));
  console.log("💾 Merkle proofs saved");

  // 4️⃣ Publish election info
  console.log("📤 Publishing election info...");
  const txInfo = await votingContract.setElectionInfo(
    ELECTION_ID,
    ELECTION_NAME,
    START_DATE,
    END_DATE,
  );
  await txInfo.wait();
  console.log("✅ setElectionInfo done");

  // 5️⃣ Publish Merkle root
  console.log("⛓ Publishing Merkle root...");
  const rootHex = ethers.zeroPadValue(ethers.toBeHex(root), 32);

  const txRoot = await votingContract.setMerkleRoot(rootHex);
  await txRoot.wait();

  console.log("✅ Merkle root published");
  console.timeEnd("⏱ build_merkle");

  console.log("👷 Setting aggregator...");

  const signers = await hre.ethers.getSigners();
  const aggregatorSigner = signers[1]; // hardhat thứ 2

  console.log("Aggregator address:", aggregatorSigner.address);

  const txAgg = await votingContract.setAggregator(aggregatorSigner.address);
  await txAgg.wait();

  console.log("✅ Aggregator set successfully");

  console.log("👷 Registering trustees...");

  // const signers = await hre.ethers.getSigners();

  // admin = signers[0] (đang connect votingContract)
  const trustee1 = signers[2];
  const trustee2 = signers[3];
  const trustee3 = signers[4];

  console.log("Trustee addresses:");
  console.log(" - Trustee 1:", trustee1.address);
  console.log(" - Trustee 2:", trustee2.address);
  console.log(" - Trustee 3:", trustee3.address);

  // Gọi hàm registerTrustees (chỉ admin gọi được)
  const txTrustees = await votingContract.registerTrustees([
    trustee1.address,
    trustee2.address,
    trustee3.address,
  ]);

  await txTrustees.wait();

  console.log("✅ Trustees registered successfully");
}

buildMerkleAndPublish().catch((err) => {
  console.error("❌ build_merkle failed:");
  console.error(err);
  process.exit(1);
});
