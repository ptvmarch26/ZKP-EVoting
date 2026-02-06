/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { groth16 } = require("snarkjs");
const { buildBabyjub } = require("circomlibjs");
const { ethers } = require("hardhat");
const { getContract } = require("../configs/blockchain");

// ===================== CONFIG =====================
// nếu bạn đã tách contract tally riêng thì bật USE_TALLY_CONTRACT = true
const USE_TALLY_CONTRACT = true;

// Benchmark
const ENABLE_BENCHMARK = false;
const ROUNDS = 100;

// Block scan
const LOOKBACK_BLOCKS = 3000;
const CHUNK_SIZE = 50;

// Circuit paths (đổi theo project của bạn)
const TALLY_INPUT_PATH = path.join(__dirname, "../circuits/inputs/tally_input.json");
const TALLY_WASM_PATH = path.join(__dirname, "../circuits/build/TallyValidity/TallyValidity_js/TallyValidity.wasm");
const TALLY_ZKEY_PATH = path.join(__dirname, "../circuits/build/TallyValidity/TallyValidity.zkey");
const TALLY_VKEY_PATH = path.join(__dirname, "../circuits/build/TallyValidity/TallyValidity_vkey.json");

// nếu trustee ID không đọc on-chain thì set cứng 2 trustee đầu
const FALLBACK_ID1 = 1n;
const FALLBACK_ID2 = 2n;

// ===================== MATH UTILS =====================
function modInverse(a, m) {
  a = ((a % m) + m) % m;
  let [r0, r1] = [a, m];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("Không tồn tại nghịch đảo modulo");
  return ((s0 % m) + m) % m;
}

function findDiscreteLog(Mpoint, G, F, babyjub, maxTries = 60000) {
  const identity = [F.e(0n), F.e(1n)];
  if (
    F.toObject(Mpoint[0]) === F.toObject(identity[0]) &&
    F.toObject(Mpoint[1]) === F.toObject(identity[1])
  ) return 0;

  let test = G;
  for (let m = 1; m <= maxTries; m++) {
    if (
      F.toObject(Mpoint[0]) === F.toObject(test[0]) &&
      F.toObject(Mpoint[1]) === F.toObject(test[1])
    ) return m;
    test = babyjub.addPoint(test, G);
  }
  return null;
}

function parseErr(e) {
  return (
    e?.shortMessage ||
    e?.reason ||
    e?.error?.message ||
    e?.data?.message ||
    e?.message ||
    "Unknown error"
  );
}

async function getEventsChunked(contract, eventFilter, startBlock, endBlock, step = 50) {
  const events = [];
  for (let from = startBlock; from <= endBlock; from += step) {
    const to = Math.min(from + step - 1, endBlock);
    try {
      const chunk = await contract.queryFilter(eventFilter, from, to);
      events.push(...chunk);
    } catch (err) {
      console.error(`⚠️ Error fetching [${from}-${to}]:`, parseErr(err));
    }
  }
  return events;
}

async function main() {
  try {
    const babyjub = await buildBabyjub();
    const F = babyjub.F;
    const G = babyjub.Base8;
    const n = babyjub.subOrder;

    // signer index 0 cho hardhat local
    const { signer, votingContract, tallyVerifierContract } = await getContract(0);
    const signerAddr = await signer.getAddress();

    const reader = votingContract; // dữ liệu tally/events nằm ở voting
    const submitter = USE_TALLY_CONTRACT ? tallyVerifierContract : votingContract;

    console.log("🔗 Signer:", signerAddr);
    console.log("🔗 Voting:", reader.target ?? reader.address);
    console.log("🔗 Submitter:", submitter.target ?? submitter.address);

    // 1) Scan events
    const latest = await ethers.provider.getBlockNumber();
    const start = Math.max(0, latest - LOOKBACK_BLOCKS);
    console.log(`📡 Scanning blocks ${start} -> ${latest}`);

    const cipherFilter = reader.filters.CipherTotalPublished();
    const partialFilter = reader.filters.PartialDecryptionSubmitted();

    const cipherEvents = await getEventsChunked(reader, cipherFilter, start, latest, CHUNK_SIZE);
    const partialEvents = await getEventsChunked(reader, partialFilter, start, latest, CHUNK_SIZE);

    if (!cipherEvents.length) throw new Error("❌ Không có CipherTotalPublished");
    if (partialEvents.length < 2) throw new Error("❌ Cần ít nhất 2 PartialDecryptionSubmitted");

    console.log(`✅ CipherTotalPublished: ${cipherEvents.length}`);
    console.log(`✅ PartialDecryptionSubmitted: ${partialEvents.length}`);

    // 2) Parse C totals (sort theo candidateId)
    const sortedCipher = [...cipherEvents].sort(
      (a, b) => Number(a.args.candidateId) - Number(b.args.candidateId)
    );

    const C2_total_x = [];
    const C2_total_y = [];
    for (const e of sortedCipher) {
      C2_total_x.push(e.args.C2_total[0].toString());
      C2_total_y.push(e.args.C2_total[1].toString());
    }

    // 3) Lấy partial decryptions theo trustee (event mới nhất mỗi trustee)
    const trusteeDecryptions = {};
    for (const e of partialEvents) {
      const trustee = e.args.trustee.toLowerCase();
      const D_points = e.args.D_points.map((pair) => [pair[0].toString(), pair[1].toString()]);
      trusteeDecryptions[trustee] = D_points; // overwrite -> giữ bản mới nhất
    }

    const trustees = Object.keys(trusteeDecryptions);
    if (trustees.length < 2) throw new Error("❌ Không đủ trustee decryptions");

    const T1 = trustees[0];
    const T2 = trustees[1];

    // thử đọc trusteeID on-chain, fail thì fallback 1/2
    let ID1 = FALLBACK_ID1;
    let ID2 = FALLBACK_ID2;
    try {
      const id1 = await reader.trusteeID(T1);
      const id2 = await reader.trusteeID(T2);
      if (BigInt(id1.toString()) > 0n && BigInt(id2.toString()) > 0n) {
        ID1 = BigInt(id1.toString());
        ID2 = BigInt(id2.toString());
      }
    } catch (_) {}

    const lambda1 = (((-ID2 * modInverse(ID1 - ID2, n)) % n) + n) % n;
    const lambda2 = (((-ID1 * modInverse(ID2 - ID1, n)) % n) + n) % n;

    console.log(`👥 Trustees: ${T1} (ID=${ID1}), ${T2} (ID=${ID2})`);
    console.log(`📏 Lagrange: λ1=${lambda1}, λ2=${lambda2}`);

    // check số candidate khớp với D_points
    const nCandidates = C2_total_x.length;
    if (
      trusteeDecryptions[T1].length < nCandidates ||
      trusteeDecryptions[T2].length < nCandidates
    ) {
      throw new Error("❌ Số D_points không khớp số candidate");
    }

    // 4) Decrypt tally + build input object for circuit
    console.time("⏱️ Tally decryption");
    const finalResults = [];
    const inputObject = {
      C2_total_x: [],
      C2_total_y: [],
      D_x: [],
      D_y: [],
      lambda: [lambda1.toString(), lambda2.toString()],
      Mx: [],
      My: [],
    };

    for (let i = 0; i < nCandidates; i++) {
      const C2 = [F.e(BigInt(C2_total_x[i])), F.e(BigInt(C2_total_y[i]))];

      const D1 = trusteeDecryptions[T1][i].map((v) => F.e(BigInt(v)));
      const D2 = trusteeDecryptions[T2][i].map((v) => F.e(BigInt(v)));

      const D1s = babyjub.mulPointEscalar(D1, lambda1);
      const D2s = babyjub.mulPointEscalar(D2, lambda2);
      const sumD = babyjub.addPoint(D1s, D2s);

      const negSumD = [F.neg(sumD[0]), sumD[1]];
      const M = babyjub.addPoint(C2, negSumD);

      const votes = findDiscreteLog(M, G, F, babyjub, 60000);

      finalResults.push({
        candidateId: i + 1,
        Mx: F.toObject(M[0]).toString(),
        My: F.toObject(M[1]).toString(),
        votes: votes ?? "unknown",
      });

      inputObject.C2_total_x.push(C2_total_x[i]);
      inputObject.C2_total_y.push(C2_total_y[i]);
      inputObject.D_x.push([trusteeDecryptions[T1][i][0], trusteeDecryptions[T2][i][0]]);
      inputObject.D_y.push([trusteeDecryptions[T1][i][1], trusteeDecryptions[T2][i][1]]);
      inputObject.Mx.push(F.toObject(M[0]).toString());
      inputObject.My.push(F.toObject(M[1]).toString());
    }
    console.timeEnd("⏱️ Tally decryption");

    console.log("🎯 Final results:", finalResults);

    // 5) Save tally input
    fs.mkdirSync(path.dirname(TALLY_INPUT_PATH), { recursive: true });
    fs.writeFileSync(TALLY_INPUT_PATH, JSON.stringify(inputObject, null, 2));
    console.log(`🧾 Saved tally input: ${TALLY_INPUT_PATH}`);

    // 6) Generate proof TallyValidity
    console.time("⏱️ Tally proof generation");
    const input = JSON.parse(fs.readFileSync(TALLY_INPUT_PATH, "utf8"));
    const { proof, publicSignals } = await groth16.fullProve(
      input,
      TALLY_WASM_PATH,
      TALLY_ZKEY_PATH
    );
    console.timeEnd("⏱️ Tally proof generation");

    // 7) Verify off-chain
    const vKey = JSON.parse(fs.readFileSync(TALLY_VKEY_PATH, "utf8"));
    const okOff = await groth16.verify(vKey, publicSignals, proof);
    if (!okOff) throw new Error("❌ Tally proof off-chain verify FAILED");
    console.log("✅ Tally proof off-chain verify PASSED");

    // 8) Format calldata
    const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
    const argv = calldata.replace(/["[\]\s]/g, "").split(",").map((x) => BigInt(x).toString());

    const a = [argv[0], argv[1]];
    const b = [
      [argv[2], argv[3]],
      [argv[4], argv[5]],
    ];
    const c = [argv[6], argv[7]];
    const inputSignals = argv.slice(8); // dùng full signals, không cắt [0]

    console.log("📌 publicSignals length:", publicSignals.length);
    console.log("📌 inputSignals length:", inputSignals.length);

    // 9) Preflight on-chain static call
    try {
      const okStatic = await submitter.submitTallyProof.staticCall(a, b, c, inputSignals);
      console.log("🧪 submitTallyProof.staticCall:", okStatic);
    } catch (e) {
      console.log("⚠️ staticCall reverted:", parseErr(e));
      throw e;
    }

    // 10) Send tx (1 lần hoặc benchmark)
    if (!ENABLE_BENCHMARK) {
      const tx = await submitter.submitTallyProof(a, b, c, inputSignals);
      const rc = await tx.wait();
      console.log(`✅ submitTallyProof tx: ${tx.hash} status=${rc?.status}`);
      return;
    }

    console.log(`🚀 Benchmark ${ROUNDS} rounds submitTallyProof...`);
    const times = [];
    for (let i = 1; i <= ROUNDS; i++) {
      const t0 = Date.now();
      const tx = await submitter.submitTallyProof(a, b, c, inputSignals);
      await tx.wait();
      const t1 = Date.now();
      const sec = (t1 - t0) / 1000;
      times.push(sec);
      console.log(`🏁 Round ${i}/${ROUNDS}: ${sec.toFixed(3)} s`);
    }

    const avg = times.reduce((s, x) => s + x, 0) / times.length;
    const variance = times.reduce((s, x) => s + (x - avg) ** 2, 0) / times.length;
    const stdDev = Math.sqrt(variance);

    console.log("\n📊 Benchmark Summary:");
    console.log(`   Avg: ${avg.toFixed(3)} s`);
    console.log(`   Std: ${stdDev.toFixed(3)} s`);
  } catch (err) {
    console.error("❌ Error:", parseErr(err));
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
