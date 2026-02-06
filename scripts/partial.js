/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { groth16 } = require("snarkjs");
const { buildBabyjub } = require("circomlibjs");
const { ethers } = require("hardhat");
const { getContract } = require("../configs/blockchain");

// ===================== CONFIG =====================
const DKG_PATH = path.join(__dirname, "../data/dkgKeys");
const WASM_PATH = path.join(__dirname, "../circuits/build/PartialDecryption/PartialDecryption_js/PartialDecryption.wasm");
const ZKEY_PATH = path.join(__dirname, "../circuits/build/PartialDecryption/PartialDecryption.zkey");
// 🔑 Thêm đường dẫn Verification Key
const VKEY_PATH = path.join(__dirname, "../circuits/build/PartialDecryption/PartialDecryption_vkey.json");

const RUN_CONFIG = [
    { index: 0, keyFile: "Admin_Trustee.json", name: "Admin (Trustee 3)" }
//   { index: 2, keyFile: "Trustee_1.json", name: "Trustee 1" },
];

async function main() {
  const babyjub = await buildBabyjub();
  const { F } = babyjub;

  // 1️⃣ Lấy dữ liệu C1 tổng hợp từ Blockchain
  const { votingContract: contractReader } = await getContract(0);
  const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8")); // Load VKey

  console.log("📡 Fetching aggregated C1 points from blockchain...");
  const latestBlock = await ethers.provider.getBlockNumber();
  const startBlock = Math.max(0, latestBlock - 1000); 

  const filter = contractReader.filters.CipherTotalPublished();
  const events = await contractReader.queryFilter(filter, startBlock, latestBlock);
  if (events.length === 0) throw new Error("❌ Không thấy CipherTotalPublished.");

  const sortedEvents = events.sort((a, b) => Number(a.args.candidateId) - Number(b.args.candidateId));

  let C1_sum = [F.e(BigInt(sortedEvents[0].args.C1_total[0])), F.e(BigInt(sortedEvents[0].args.C1_total[1]))];
  for (let i = 1; i < sortedEvents.length; i++) {
    const nextC1 = [F.e(BigInt(sortedEvents[i].args.C1_total[0])), F.e(BigInt(sortedEvents[i].args.C1_total[1]))];
    C1_sum = babyjub.addPoint(C1_sum, nextC1);
  }

  const C1_sum_x = F.toObject(C1_sum[0]).toString();
  const C1_sum_y = F.toObject(C1_sum[1]).toString();

  // 2️⃣ Duyệt qua từng Trustee
  for (const trustee of RUN_CONFIG) {
    console.log(`\n--- 🎭 Role: ${trustee.name} ---`);
    const { votingContract, signer } = await getContract(trustee.index);
    
    const keyData = JSON.parse(fs.readFileSync(path.join(DKG_PATH, trustee.keyFile), "utf8"));
    const s_i = BigInt(keyData.share);
    const PKi = keyData.pk_share;

    const D_points_array = sortedEvents.map(e => {
      const C1 = [F.e(BigInt(e.args.C1_total[0])), F.e(BigInt(e.args.C1_total[1]))];
      const Di = babyjub.mulPointEscalar(C1, s_i);
      return [F.toObject(Di[0]).toString(), F.toObject(Di[1]).toString()];
    });

    const D_total = babyjub.mulPointEscalar(C1_sum, s_i);
    const D_total_x = F.toObject(D_total[0]).toString();
    const D_total_y = F.toObject(D_total[1]).toString();

    const witnessInput = {
      s_i: s_i.toString(),
      C1x: C1_sum_x,
      C1y: C1_sum_y,
      D_ix: D_total_x,
      D_iy: D_total_y,
      PKx: PKi.x.toString(),
      PKy: PKi.y.toString(),
    };

    // 🧩 Sinh Proof
    console.log(`🧩 Generating ZK Proof...`);
    const { proof, publicSignals } = await groth16.fullProve(witnessInput, WASM_PATH, ZKEY_PATH);

    // 🔍 BƯỚC MỚI: Verify Off-chain
    console.log("🔍 Verifying Proof Off-chain...");
    const res = await groth16.verify(vKey, publicSignals, proof);
    if (!res) {
        console.error("❌ Proof OFF-CHAIN FAILED! Dừng script để tránh mất Gas.");
        console.log("Public Signals:", publicSignals);
        process.exit(1);
    }
    console.log("✅ Proof OFF-CHAIN VALID!");

    // ⛓ Chuẩn bị dữ liệu nộp On-chain
    const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
    const argv = calldata.replace(/["[\]\s]/g, "").split(",").map((x) => BigInt(x).toString());

    const a = [argv[0], argv[1]];
    const b = [[argv[2], argv[3]], [argv[4], argv[5]]];
    const c = [argv[6], argv[7]];
    const inputSignals = argv.slice(8); 

    console.log("📡 Public Signals (a):", a);
    console.log("📡 Public Signals (b):", b);
    console.log("📡 Public Signals (c):", c);
    console.log("📡 Public Signals (On-chain):", inputSignals);

    // ⛓ Giao dịch 1: Verify On-chain
    process.stdout.write("⛓  Verifying Proof on-chain...");
    const txVerify = await votingContract.verifyPartialProof(a, b, c, inputSignals);
    await txVerify.wait();
    console.log(" [DONE]");

    // ⛓ Giao dịch 2: Publish D_i
    process.stdout.write(`⛓  Publishing ${D_points_array.length} D_i points...`);
    const txPub = await votingContract.publishPartialDecryption(D_points_array);
    await txPub.wait();
    console.log(" [DONE]");
  }

  const currentCount = await contractReader.thresholdCount();
  console.log(`\n🏁 Kết quả: ${currentCount.toString()}/2 hoàn tất.`);
}

main().catch(console.error);