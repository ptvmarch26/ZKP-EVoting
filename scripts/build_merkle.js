const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { buildPoseidon } = require("circomlibjs");

const merkleUtils = require("../utils/merkleUtils");
const { contract } = require("../configs/blockchain");

// ===== CONFIG =====
const VOTER_DB_FILE = path.join(
  __dirname,
  "../data/voter_data_for_db_10.json"
);

const ELECTION_ID = "ELC2024";
const ELECTION_NAME = "Demo Election";
const START_DATE = Math.floor(Date.now() / 1000);
const END_DATE = START_DATE + 7 * 24 * 3600;

// ===== MAIN =====
async function buildMerkleAndPublish() {
  console.time("⏱ build_merkle");

  // 1️⃣ Load voter DB
  const voters = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
  if (!voters.length) throw new Error("No voters found");

  console.log(`📦 Loaded ${voters.length} voters`);

  // 2️⃣ Build Merkle Tree
  console.log("🧩 Building Poseidon Merkle Tree...");
  const poseidon = await buildPoseidon();

  const leaves = voters.map(v => BigInt(v.hashed_key));
  const tree = merkleUtils.buildMerkleTree(poseidon, leaves);
  const root = merkleUtils.getMerkleRoot(tree);

  console.log("🌳 Merkle root:", root.toString());

  // 3️⃣ Generate Merkle proofs & write BACK to voter_data_for_db
  voters.forEach((voter, index) => {
    const { pathElements, pathIndices } =
      merkleUtils.getMerkleProof(tree, index);

    voter.merkle_proof = {
      path_elements: pathElements.map(String),
      path_indices: pathIndices.map(String),
    };
  });

  fs.writeFileSync(VOTER_DB_FILE, JSON.stringify(voters, null, 2));
  console.log("💾 Merkle proofs saved into voter_data_for_db");

  // 4️⃣ Publish election info
  console.log("📤 Publishing election info...");
  const txInfo = await contract.setElectionInfo(
    ELECTION_ID,
    ELECTION_NAME,
    START_DATE,
    END_DATE
  );
  await txInfo.wait();
  console.log("✅ setElectionInfo done");

  // 5️⃣ Publish Merkle root
  console.log("⛓ Publishing Merkle root...");
  const rootHex = ethers.zeroPadValue(
    ethers.toBeHex(root),
    32
  );

  const txRoot = await contract.setMerkleRoot(rootHex);
  const receipt = await txRoot.wait();

  console.log("✅ Merkle root published");
  console.log("TX:", receipt.hash);

  console.timeEnd("⏱ build_merkle");
}

buildMerkleAndPublish().catch(err => {
  console.error("❌ build_merkle failed:");
  console.error(err);
  process.exit(1);
});
