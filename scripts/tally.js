// /* eslint-disable no-console */
// const fs = require("fs");
// const path = require("path");
// const { groth16 } = require("snarkjs");
// const { buildBabyjub } = require("circomlibjs");
// const { getContract } = require("../configs/blockchain");

// // =======================================================
// // CONFIG
// // =======================================================
// const AGGREGATOR_INDEX = 1; // signer đã set làm aggregator
// const SECRET_KEY = BigInt(
//   "1777057593178280414545006270989564043545364506684196906421583838431977886106"
// );

// const START_BLOCK = 1;
// const END_BLOCK = "latest";

// // =======================================================
// // Discrete log (demo, small tally)
// // =======================================================
// function findDiscreteLog(M, G, F, babyjub, maxTries = 100000) {
//   const identity = [F.e(0n), F.e(1n)];
//   if (
//     F.toObject(M[0]) === F.toObject(identity[0]) &&
//     F.toObject(M[1]) === F.toObject(identity[1])
//   )
//     return 0;

//   let cur = G;
//   for (let i = 1; i <= maxTries; i++) {
//     if (
//       F.toObject(cur[0]) === F.toObject(M[0]) &&
//       F.toObject(cur[1]) === F.toObject(M[1])
//     )
//       return i;
//     cur = babyjub.addPoint(cur, G);
//   }
//   return null;
// }

// // =======================================================
// // MAIN
// // =======================================================
// async function main() {
//   const babyjub = await buildBabyjub();
//   const F = babyjub.F;
//   const G = babyjub.Base8;

//   const { votingContract, tallyVerifierContract } =
//     await getContract(AGGREGATOR_INDEX);

//   console.log("🔗 Voting contract:", await votingContract.getAddress());
//   console.log("🔗 Tally contract:", await tallyVerifierContract.getAddress());

//   // ===================================================
//   // 1️⃣ Read CipherTotalPublished
//   // ===================================================
//   const latestBlock =
//     END_BLOCK === "latest"
//       ? await votingContract.runner.provider.getBlockNumber()
//       : END_BLOCK;

//   const events = await votingContract.queryFilter(
//     "CipherTotalPublished",
//     START_BLOCK,
//     latestBlock
//   );

//   if (events.length === 0) {
//     console.log("⚠️ No CipherTotalPublished events");
//     return;
//   }

//   const C1x = [],
//     C1y = [],
//     C2x = [],
//     C2y = [];

//   for (const e of events) {
//     C1x.push(e.args.C1_total[0].toString());
//     C1y.push(e.args.C1_total[1].toString());
//     C2x.push(e.args.C2_total[0].toString());
//     C2y.push(e.args.C2_total[1].toString());
//   }

//   const nCandidates = C1x.length;
//   console.log(`📊 Candidates: ${nCandidates}`);

//   // ===================================================
//   // 2️⃣ Decrypt (NO threshold)
//   // ===================================================
//   const tallyInput = {
//     C1_total_x: C1x,
//     C1_total_y: C1y,
//     C2_total_x: C2x,
//     C2_total_y: C2y,
//     sk: SECRET_KEY.toString(),
//     Mx: [],
//     My: [],
//   };

//   for (let i = 0; i < nCandidates; i++) {
//     const C1 = [F.e(BigInt(C1x[i])), F.e(BigInt(C1y[i]))];
//     const C2 = [F.e(BigInt(C2x[i])), F.e(BigInt(C2y[i]))];

//     const skC1 = babyjub.mulPointEscalar(C1, SECRET_KEY);
//     const neg = [F.neg(skC1[0]), skC1[1]];
//     const M = babyjub.addPoint(C2, neg);

//     const votes = findDiscreteLog(M, G, F, babyjub);

//     tallyInput.Mx.push(F.toObject(M[0]).toString());
//     tallyInput.My.push(F.toObject(M[1]).toString());

//     console.log(`🧮 Candidate ${i + 1}: ${votes} votes`);
//   }

//   // ===================================================
//   // 3️⃣ Prove TallyValidity
//   // ===================================================
//   const wasmPath = path.join(
//     __dirname,
//     "../circuits/build/TallyValidity/TallyValidity_js/TallyValidity.wasm"
//   );
//   const zkeyPath = path.join(
//     __dirname,
//     "../circuits/build/TallyValidity/TallyValidity.zkey"
//   );

//   console.time("⏱ tally-proof");
//   const { proof, publicSignals } = await groth16.fullProve(
//     tallyInput,
//     wasmPath,
//     zkeyPath
//   );
//   console.timeEnd("⏱ tally-proof");

//   // ===================================================
//   // 4️⃣ Export calldata & submit ON-CHAIN ONLY
//   // ===================================================
//   const calldata = await groth16.exportSolidityCallData(
//     proof,
//     publicSignals
//   );

//   const argv = calldata
//     .replace(/["[\]\s]/g, "")
//     .split(",")
//     .map(BigInt);

//   const a = [argv[0].toString(), argv[1].toString()];
//   const b = [
//     [argv[2].toString(), argv[3].toString()],
//     [argv[4].toString(), argv[5].toString()],
//   ];
//   const c = [argv[6].toString(), argv[7].toString()];
//   const inputSignals = [publicSignals[0].toString()];

//   console.log("🚀 Benchmark submitTallyProof (100 rounds)");

//   const times = [];
//   for (let i = 1; i <= 1; i++) {
//     const t0 = Date.now();
//     const tx = await tallyVerifierContract.submitTallyProof(
//       a,
//       b,
//       c,
//       inputSignals
//     );
//     await tx.wait();
//     const t = (Date.now() - t0) / 1000;
//     times.push(t);
//     console.log(`🏁 Round ${i}: ${t.toFixed(3)}s`);
//   }

//   const avg = times.reduce((a, b) => a + b, 0) / times.length;
//   console.log(`📊 Avg submit time: ${avg.toFixed(3)}s`);
// }

// main().catch(console.error);


/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { groth16 } = require("snarkjs");
const { buildBabyjub } = require("circomlibjs");
const { ethers } = require("hardhat");
const { getContract } = require("../configs/blockchain");

// ===================== CONFIG =====================
// Trustee index: 0 (Admin), 2 (Trustee 1), 3 (Trustee 2) tùy bạn chọn
const TRUSTEE_INDEX = 2; 
const KEY_FILE = path.join(__dirname, "../data/dkgKeys/Trustee_1.json"); // Load private share

const WASM_PATH = path.join(__dirname, "../circuits/build/PartialDecryption_js/PartialDecryption.wasm");
const ZKEY_PATH = path.join(__dirname, "../circuits/build/PartialDecryption.zkey");

async function main() {
    const babyjub = await buildBabyjub();
    const { F, Base8: G } = babyjub;

    // 1️⃣ Kết nối Contract với tư cách Trustee
    const { votingContract, signer } = await getContract(TRUSTEE_INDEX);
    console.log(`📌 Acting as Trustee: ${await signer.getAddress()}`);

    // 2️⃣ Lấy dữ liệu C1_total từ sự kiện CipherTotalPublished trên Chain
    console.log("📡 Fetching aggregated C1 points from blockchain...");
    const filter = votingContract.filters.CipherTotalPublished();
    const events = await votingContract.queryFilter(filter, -1000); // Scan 1000 block gần nhất
    
    if (events.length === 0) throw new Error("❌ Không tìm thấy CipherTotalPublished. Aggregator chưa nộp kết quả tổng?");

    // Sắp xếp theo candidateId
    const sortedEvents = events.sort((a, b) => a.args.candidateId - b.args.candidateId);
    const C1_list = sortedEvents.map(e => ({
        x: e.args.C1_total[0].toString(),
        y: e.args.C1_total[1].toString()
    }));

    // 3️⃣ Load Secret Share từ file local
    const keyData = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
    const si = BigInt(keyData.share);
    const PKi = keyData.pk_share;

    console.log(`🧮 Calculating ${C1_list.length} partial decryption points...`);
    const D_points = [];
    const witnessInputs = [];

    for (let i = 0; i < C1_list.length; i++) {
        const C1 = [F.e(BigInt(C1_list[i].x)), F.e(BigInt(C1_list[i].y))];
        
        // Tính Di = si * C1
        const Di = babyjub.mulPointEscalar(C1, si);
        const Dix = F.toObject(Di[0]).toString();
        const Diy = F.toObject(Di[1]).toString();

        D_points.push([Dix, Diy]);

        // Chuẩn bị input cho mạch (Giả sử mạch của bạn verify từng cặp hoặc mảng)
        // Đây là ví dụ cho mạch verify 1 cặp. Nếu mạch của bạn nhận mảng, hãy điều chỉnh cấu trúc.
        witnessInputs.push({
            s_i: si.toString(),
            C1x: C1_list[i].x,
            C1y: C1_list[i].y,
            D_ix: Dix,
            D_iy: Diy,
            PKx: PKi.x,
            PKy: PKi.y
        });
    }

    // 4️⃣ Sinh ZK Proof (Ví dụ verify cho ứng cử viên đầu tiên - chỉnh theo mạch của bạn)
    console.log("🧩 Generating ZK Proof for Partial Decryption...");
    // Lưu ý: Nếu mạch bạn hỗ trợ mảng, hãy truyền cả mảng vào witnessInputs
    const { proof, publicSignals } = await groth16.fullProve(witnessInputs[0], WASM_PATH, ZKEY_PATH);

    const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
    const argv = calldata.replace(/["[\]\s]/g, "").split(",").map(x => BigInt(x).toString());

    const a = [argv[0], argv[1]];
    const b = [[argv[2], argv[3]], [argv[4], argv[5]]];
    const c = [argv[6], argv[7]];
    const inputSignals = argv.slice(8);

    // 5️⃣ Transaction 1: Verify Proof
    console.log("⛓️ Sending verifyPartialProof transaction...");
    const txVerify = await votingContract.verifyPartialProof(a, b, c, inputSignals);
    await txVerify.wait();
    console.log("✅ Proof verified on-chain!");

    // 6️⃣ Transaction 2: Publish D_points
    console.log("⛓️ Sending publishPartialDecryption transaction...");
    const txPub = await votingContract.publishPartialDecryption(D_points);
    const receipt = await txPub.wait();

    console.log(`🎉 Trustee process done! Block: ${receipt.blockNumber}`);
    const currentCount = await votingContract.thresholdCount();
    console.log(`🔢 Current thresholdCount: ${currentCount.toString()}`);
}

main().catch(console.error);