/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const hre = require("hardhat");
const { ethers } = hre;

const snarkjs = require("snarkjs");
const { buildBabyjub, buildPoseidon } = require("circomlibjs");

const merkleUtils = require("../utils/merkleUtils");
const { getContract } = require("../configs/blockchain");

// ===================== CONFIG =====================
const VOTER_DB_FILE = path.join(__dirname, "../data/voter_data_for_db_10.json");
const VOTER_SECRETS_FILE = path.join(
  __dirname,
  "../data/voter_secrets_for_script_10.json"
);

const WASM_PATH = path.join(
  __dirname,
  "../circuits/build/VoteProofCombined/VoteProofCombined_js/VoteProofCombined.wasm"
);
const ZKEY_PATH = path.join(
  __dirname,
  "../circuits/build/VoteProofCombined/VoteProofCombined.zkey"
);
const VKEY_PATH = path.join(
  __dirname,
  "../circuits/build/VoteProofCombined/VoteProofCombined_vkey.json"
);

const ELECTION_ID = "ELC2024";
const NUM_CANDIDATES = 2;
const VOTES_TO_SIMULATE = 10;
const DELAY_MS = 150;

const VOTE_OUT_FILE = path.join(__dirname, "../data/vote.json");

// Public key hệ thống
const PKx =
  21680280801500410089603254291759724685832522858977792691789812312913590634826n;
const PKy =
  21458544517199629132698525448185749257876821186292688624013904062558371908628n;

// ==================================================

// reset vote.json
fs.writeFileSync(VOTE_OUT_FILE, JSON.stringify([], null, 2), "utf8");

// ===================== HELPERS =====================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function appendVote(voteObj) {
  const arr = JSON.parse(fs.readFileSync(VOTE_OUT_FILE, "utf8"));
  arr.push(voteObj);
  fs.writeFileSync(VOTE_OUT_FILE, JSON.stringify(arr, null, 2), "utf8");
}

function toBytes32BN(x) {
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(x)), 32);
}

function poseidonHashString(poseidon, s) {
  const F = poseidon.F;
  const arr = Array.from(s).map((c) => BigInt(c.charCodeAt(0)));
  return F.toObject(poseidon(arr)).toString();
}

// ===================== ENCRYPT =====================
async function encryptVote(babyjub, PKx, PKy, numCandidates, choice) {
  const F = babyjub.F;
  const G = babyjub.Base8;
  const n = babyjub.subOrder;
  const PK = [F.e(PKx), F.e(PKy)];

  const mVec = Array(numCandidates).fill(0n);
  mVec[choice] = 1n;

  const rVec = Array.from({ length: numCandidates }, () => {
    const rb = crypto.randomBytes(32);
    return BigInt("0x" + rb.toString("hex")) % n;
  });

  const C1x = [], C1y = [], C2x = [], C2y = [];

  for (let i = 0; i < numCandidates; i++) {
    const C1 = babyjub.mulPointEscalar(G, rVec[i]);
    const rPK = babyjub.mulPointEscalar(PK, rVec[i]);
    const mG = babyjub.mulPointEscalar(G, mVec[i]);
    const C2 = babyjub.addPoint(mG, rPK);

    C1x.push(F.toObject(C1[0]).toString());
    C1y.push(F.toObject(C1[1]).toString());
    C2x.push(F.toObject(C2[0]).toString());
    C2y.push(F.toObject(C2[1]).toString());
  }

  return { m: mVec.map(String), r: rVec.map(String), C1x, C1y, C2x, C2y };
}

// ===================== VERIFY + SUBMIT (OFF-CHAIN) =====================
function makeVerifyValidVoteLocal({ votingContract, vKey }) {
  const seen = new Set();

  return async function verifyValidVoteLocal(proof, publicSignals, voteData) {
    const ok = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    if (!ok) return { EC: 1, EM: "Invalid proof" };

    const key = `${voteData.election_id}|${voteData.nullifier}`;
    if (seen.has(key)) return { EC: 2, EM: "Duplicate vote" };
    seen.add(key);

    const tx = await votingContract.submitVote(
      toBytes32BN(voteData.nullifier),
      toBytes32BN(publicSignals[1]),
      "123"
    );

    const receipt = await tx.wait();
    return { EC: 0, EM: "OK", txHash: receipt.hash };
  };
}

// ===================== MAIN =====================
async function main() {
  const { votingContract, signer } = await getContract();
  const voting = votingContract.connect(
    new ethers.NonceManager(signer)
  );

  const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));
  const verifyValidVoteLocal = makeVerifyValidVoteLocal({
    votingContract: voting,
    vKey,
  });

  const voterDb = JSON.parse(fs.readFileSync(VOTER_DB_FILE, "utf8"));
  const voterSecrets = JSON.parse(fs.readFileSync(VOTER_SECRETS_FILE, "utf8"));

  const dbMap = new Map(voterDb.map((v) => [String(v.hashed_key), v]));
  const eligible = voterSecrets.filter((s) =>
    dbMap.has(String(s.hashed_key))
  );

  const babyjub = await buildBabyjub();
  const poseidon = await buildPoseidon();

  const leaves = voterDb.map((v) => BigInt(v.hashed_key));
  const tree = merkleUtils.buildMerkleTree(poseidon, leaves);
  const root = merkleUtils.getMerkleRoot(tree).toString();
  const election_hash = poseidonHashString(poseidon, ELECTION_ID);

  for (let i = 0; i < Math.min(VOTES_TO_SIMULATE, eligible.length); i++) {
    const s = eligible[i];
    const dbRec = dbMap.get(String(s.hashed_key));
    const choice = Math.floor(Math.random() * NUM_CANDIDATES);

    try {
      const { m, r, C1x, C1y, C2x, C2y } =
        await encryptVote(
          babyjub,
          PKx,
          PKy,
          NUM_CANDIDATES,
          choice
        );

      const witnessInputs = {
        sk: String(s.sk_bjj),
        pathElements: dbRec.merkle_proof.path_elements,
        pathIndices: dbRec.merkle_proof.path_indices,
        root,
        hash_pk: String(s.hashed_key),
        election_hash,
        PKx: PKx.toString(),
        PKy: PKy.toString(),
        r,
        m,
        C1x,
        C1y,
        C2x,
        C2y,
      };

      const { proof, publicSignals } =
        await snarkjs.groth16.fullProve(
          witnessInputs,
          WASM_PATH,
          ZKEY_PATH
        );

      const voteData = {
        election_id: ELECTION_ID,
        nullifier: publicSignals[0],
      };

      const res = await verifyValidVoteLocal(
        proof,
        publicSignals,
        voteData
      );

      appendVote({
        election_id: ELECTION_ID,
        hashed_key: String(s.hashed_key),
        choice,
        C1x,
        C1y,
        C2x,
        C2y,
        nullifier: String(publicSignals[0]),
        hashCipher: String(publicSignals[1]),
        txHash: res.txHash || null,
        status: res.EC === 0 ? "SUBMITTED" : "FAILED",
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      appendVote({
        election_id: ELECTION_ID,
        hashed_key: String(s.hashed_key),
        error: String(e.stack || e),
        timestamp: new Date().toISOString(),
      });
    }

    await delay(DELAY_MS);
  }

  console.log("✅ Voting simulation finished. Output:", VOTE_OUT_FILE);
}

main().catch(console.error);
