// const fs = require("fs");
// const path = require("path");
// const hre = require("hardhat");
// const { buildPoseidon } = require("circomlibjs");
// const merkleUtils = require("../utils/merkleUtils");
// const { ethers } = hre;
// const { getContract } = require("../configs/blockchain");
// const VOTER_DB_FILE = path.join(__dirname, "../data/voter_data_for_db_10.json");

// const ELECTION_ID = "ELC2024";
// const ELECTION_NAME = "Demo Election";
// const START_DATE = Math.floor(Date.now() / 1000);
// const END_DATE = START_DATE + 7 * 24 * 3600;

// // ===== MAIN =====
// async function buildMerkleAndPublish() {
//   console.time("⏱ build_merkle");

//   const { votingContract } = await getContract();
//   // 1️⃣ Load voter DB
//   const voters = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
//   if (!voters.length) throw new Error("No voters found");

//   console.log(`📦 Loaded ${voters.length} voters`);

//   // 2️⃣ Build Merkle Tree
//   console.log("🧩 Building Poseidon Merkle Tree...");
//   const poseidon = await buildPoseidon();

//   const leaves = voters.map((v) => BigInt(v.hashed_key));
//   const tree = merkleUtils.buildMerkleTree(poseidon, leaves);
//   const root = merkleUtils.getMerkleRoot(tree);

//   console.log("🌳 Merkle root:", root.toString());

//   // 3️⃣ Generate Merkle proofs
//   voters.forEach((voter, index) => {
//     const { pathElements, pathIndices } = merkleUtils.getMerkleProof(
//       tree,
//       index,
//     );

//     voter.merkle_proof = {
//       path_elements: pathElements.map(String),
//       path_indices: pathIndices.map(String),
//     };
//   });

//   fs.writeFileSync(VOTER_DB_FILE, JSON.stringify(voters, null, 2));
//   console.log("💾 Merkle proofs saved");

//   // 4️⃣ Publish election info
//   console.log("📤 Publishing election info...");
//   const txInfo = await votingContract.setElectionInfo(
//     ELECTION_ID,
//     ELECTION_NAME,
//     START_DATE,
//     END_DATE,
//   );
//   await txInfo.wait();
//   console.log("✅ setElectionInfo done");

//   // 5️⃣ Publish Merkle root
//   console.log("⛓ Publishing Merkle root...");
//   const rootHex = ethers.zeroPadValue(ethers.toBeHex(root), 32);

//   const txRoot = await votingContract.setMerkleRoot(rootHex);
//   await txRoot.wait();

//   console.log("✅ Merkle root published");
//   console.timeEnd("⏱ build_merkle");

//   console.log("👷 Setting aggregator...");

//   const signers = await hre.ethers.getSigners();
//   const aggregatorSigner = signers[1]; // hardhat thứ 2

//   console.log("Aggregator address:", aggregatorSigner.address);

//   const txAgg = await votingContract.setAggregator(aggregatorSigner.address);
//   await txAgg.wait();

//   console.log("✅ Aggregator set successfully");

//   console.log("👷 Registering trustees...");

//   // const signers = await hre.ethers.getSigners();

//   // admin = signers[0] (đang connect votingContract)
//   const trustee1 = signers[2];
//   const trustee2 = signers[3];
//   const trustee3 = signers[4];

//   console.log("Trustee addresses:");
//   console.log(" - Trustee 1:", trustee1.address);
//   console.log(" - Trustee 2:", trustee2.address);
//   console.log(" - Trustee 3:", trustee3.address);

//   // Gọi hàm registerTrustees (chỉ admin gọi được)
//   const txTrustees = await votingContract.registerTrustees([
//     trustee1.address,
//     trustee2.address,
//     trustee3.address,
//   ]);

//   await txTrustees.wait();

//   console.log("✅ Trustees registered successfully");
// }

// buildMerkleAndPublish().catch((err) => {
//   console.error("❌ build_merkle failed:");
//   console.error(err);
//   process.exit(1);
// });

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const hre = require("hardhat");
const { buildPoseidon, buildBabyjub } = require("circomlibjs");
const merkleUtils = require("../utils/merkleUtils");

const { ethers } = hre;
const { getContract } = require("../configs/blockchain");

const VOTER_DB_FILE = path.join(__dirname, "../data/voter_data_for_db_10.json");
const DKG_FOLDER = path.join(__dirname, "../data/dkgKeys"); // Lưu vào data/dkgKeys

// ===== HELPER: Tính đa thức cho DKG =====
function evalPolynomial(coeffs, x, n) {
  let res = 0n;
  const X = BigInt(x);
  for (let i = 0; i < coeffs.length; i++) {
    res = (res + coeffs[i] * X ** BigInt(i)) % n;
  }
  return res;
}

async function buildMerkleAndPublish() {
  console.time("⏱ Total_Process");

  const { votingContract } = await getContract();
  const signers = await hre.ethers.getSigners();

  // --- 1️⃣ Xử lý Merkle Tree cho cử tri ---
  console.log("🧩 Building Merkle Tree...");
  const voters = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
  const poseidon = await buildPoseidon();
  const leaves = voters.map((v) => BigInt(v.hashed_key));
  const tree = merkleUtils.buildMerkleTree(poseidon, leaves);
  const root = merkleUtils.getMerkleRoot(tree);

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

  const rootHex = ethers.zeroPadValue(ethers.toBeHex(root), 32);
  await (
    await votingContract.setElectionInfo(
      "ELC2024",
      "Demo Election",
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000) + 604800,
    )
  ).wait();
  await (await votingContract.setMerkleRoot(rootHex)).wait();
  console.log("✅ Merkle root & Election Info published");

  // --- 2️⃣ Cấu hình Aggregator ---
  const aggregatorSigner = signers[1];
  await (await votingContract.setAggregator(aggregatorSigner.address)).wait();
  console.log("✅ Aggregator set:", aggregatorSigner.address);

  // --- 3️⃣ Logic DKG (Tạo khóa cho Trustee) ---
  console.log("👷 Generating DKG Keys...");
  const babyjub = await buildBabyjub();
  const { F, Base8: G, subOrder: n } = babyjub;

  if (!fs.existsSync(DKG_FOLDER)) fs.mkdirSync(DKG_FOLDER, { recursive: true });

  // Định nghĩa Trustee: Signer 2, 3 và Admin (Signer 0)
  const trusteeConfigs = [
    { name: "Trustee_1", address: signers[2].address },
    { name: "Trustee_2", address: signers[3].address },
    { name: "Admin_Trustee", address: signers[0].address },
  ];
  const threshold = 2;

  // Mỗi bên tạo hệ số đa thức riêng
  const polys = trusteeConfigs.map((t) => ({
    ...t,
    coeffs: Array.from(
      { length: threshold },
      () => BigInt("0x" + crypto.randomBytes(32).toString("hex")) % n,
    ),
  }));

  // Tính Public Key tổng của hệ thống
  const pkPoint = polys.reduce(
    (acc, p) => babyjub.addPoint(acc, babyjub.mulPointEscalar(G, p.coeffs[0])),
    [F.e(0n), F.e(1n)],
  );
  const epk = {
    x: F.toObject(pkPoint[0]).toString(),
    y: F.toObject(pkPoint[1]).toString(),
  };
  fs.writeFileSync(
    path.join(DKG_FOLDER, "public_key.json"),
    JSON.stringify(epk, null, 2),
  );

  // Tính Secret Share và PK Share cho từng bên
  const trusteeAddresses = [];
  for (let i = 0; i < trusteeConfigs.length; i++) {
    const IDi = BigInt(i + 1);
    const mySecret = polys.reduce(
      (acc, p) => (acc + evalPolynomial(p.coeffs, IDi, n)) % n,
      0n,
    );
    const myPkPoint = babyjub.mulPointEscalar(G, mySecret);

    const keyData = {
      trustee: trusteeConfigs[i].name,
      address: trusteeConfigs[i].address,
      id: i + 1,
      share: mySecret.toString(),
      pk_share: {
        x: F.toObject(myPkPoint[0]).toString(),
        y: F.toObject(myPkPoint[1]).toString(),
      },
    };

    fs.writeFileSync(
      path.join(DKG_FOLDER, `${trusteeConfigs[i].name}.json`),
      JSON.stringify(keyData, null, 2),
    );
    trusteeAddresses.push(trusteeConfigs[i].address);
  }

  // --- 4️⃣ Đăng ký Trustee lên Smart Contract ---
  console.log("🔗 Registering Trustees on-chain...");
  const txTrustees = await votingContract.registerTrustees(trusteeAddresses);
  await txTrustees.wait();

  console.log("✅ SYSTEM READY");
  console.log("- Merkle Root Published");
  console.log("- DKG Keys saved to /data/dkgKeys/");
  console.log("- Trustees Registered (Admin is Trustee 3)");
  console.timeEnd("⏱ Total_Process");
}

buildMerkleAndPublish().catch(console.error);
