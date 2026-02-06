/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const hre = require("hardhat");
const { ethers } = hre;
const { buildBabyjub, buildPoseidon } = require("circomlibjs");

const { getContract } = require("../configs/blockchain");

// ================= CONFIG =================
const VOTE_FILE = path.join(__dirname, "../data/vote.json");
const TALLY_OUT = path.join(__dirname, "../data/aggregation.json");

const START_BLOCK = 1;
const STEP = 50;
// ==========================================

// ===== 1️⃣ GET HASH ON-CHAIN =====
async function getAllHashOnChain(votingContract) {
  console.log("📡 Scan VotePublished events...");

  const latest = await ethers.provider.getBlockNumber();
  const hashSet = new Set();

  for (let from = START_BLOCK; from <= latest; from += STEP) {
    const to = Math.min(from + STEP - 1, latest);
    const events = await votingContract.queryFilter("VotePublished", from, to);

    for (const e of events) {
      if (e.args?.hashCipher) {
        hashSet.add(e.args.hashCipher.toString());
      }
    }
  }

  console.log(`✅ On-chain hashCipher: ${hashSet.size}`);
  return hashSet;
}

// ===== MAIN =====
async function main() {
  console.log("🚀 AGGREGATE START");

  // ✅ signer1 = aggregator
const { votingContract, signer } = await getContract(1);

  console.log("🧑‍⚖️ Using signer:", await signer.getAddress());
  console.log("🏷️ Aggregator on-chain:", await votingContract.aggregator());

  // ===== on-chain hashes =====
  const hashOnChain = await getAllHashOnChain(votingContract);
  if (hashOnChain.size === 0) {
    console.warn("⚠️ No on-chain votes");
    return;
  }

  // ===== load vote.json =====
  if (!fs.existsSync(VOTE_FILE)) {
    throw new Error("❌ data/vote.json not found");
  }

  const votes = JSON.parse(fs.readFileSync(VOTE_FILE, "utf8"));
  if (!Array.isArray(votes) || votes.length === 0) {
    console.warn("⚠️ vote.json empty");
    return;
  }

  console.log(`📦 Loaded ${votes.length} votes from file`);

  // ===== crypto init =====
  const babyjub = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = babyjub.F;

  const nCandidates = votes[0].C1x.length;

  let C1_total_x = Array(nCandidates).fill(F.e(0n));
  let C1_total_y = Array(nCandidates).fill(F.e(1n));
  let C2_total_x = Array(nCandidates).fill(F.e(0n));
  let C2_total_y = Array(nCandidates).fill(F.e(1n));

  let validVotes = 0;

  console.time("⏱ tally");

  for (const v of votes) {
    let acc = F.e(0n);

    for (let i = 0; i < nCandidates; i++) {
      const h = poseidon([
        BigInt(v.C1x[i]),
        BigInt(v.C1y[i]),
        BigInt(v.C2x[i]),
        BigInt(v.C2y[i]),
      ]);
      acc = poseidon([acc, h]);
    }

    const hashCipherBytes32 = ethers.zeroPadValue(
      ethers.toBeHex(BigInt(F.toObject(acc)) ),
      32
    );

    if (!hashOnChain.has(hashCipherBytes32)) continue;

    validVotes++;

    for (let i = 0; i < nCandidates; i++) {
      const C1 = [F.e(BigInt(v.C1x[i])), F.e(BigInt(v.C1y[i]))];
      const C2 = [F.e(BigInt(v.C2x[i])), F.e(BigInt(v.C2y[i]))];

      const nC1 = babyjub.addPoint([C1_total_x[i], C1_total_y[i]], C1);
      const nC2 = babyjub.addPoint([C2_total_x[i], C2_total_y[i]], C2);

      C1_total_x[i] = nC1[0];
      C1_total_y[i] = nC1[1];
      C2_total_x[i] = nC2[0];
      C2_total_y[i] = nC2[1];
    }
  }

  console.timeEnd("⏱ tally");

  const aggregation = {
    nCandidates,
    validVotes,
    C1_total_x: C1_total_x.map(x => F.toObject(x).toString()),
    C1_total_y: C1_total_y.map(y => F.toObject(y).toString()),
    C2_total_x: C2_total_x.map(x => F.toObject(x).toString()),
    C2_total_y: C2_total_y.map(y => F.toObject(y).toString()),
  };

  fs.writeFileSync(TALLY_OUT, JSON.stringify(aggregation, null, 2));
  console.log("📄 aggregation.json written");

  // ===== 🚀 PUBLISH =====
  console.log("📤 Publishing cipher totals...");

  const C1_list = aggregation.C1_total_x.map((x, i) => [
    x,
    aggregation.C1_total_y[i],
  ]);
  const C2_list = aggregation.C2_total_x.map((x, i) => [
    x,
    aggregation.C2_total_y[i],
  ]);

  const tx = await votingContract.publishAllCipherTotals(C1_list, C2_list);
  console.log("⛓️ tx:", tx.hash);

  const receipt = await tx.wait();
  console.log("✅ Publish DONE | gas:", receipt.gasUsed.toString());
  console.log("🎉 AGGREGATE + PUBLISH DONE");
}

main().catch((e) => {
  console.error("❌ Aggregate failed:", e);
  process.exit(1);
});
