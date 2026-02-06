pragma circom 2.1.5;

// ======================= IMPORT =======================
include "./VoterValidity.circom";
include "./CiphertextValidity.circom";
include "circomlib/circuits/poseidon.circom";

// ======================================================
// MẠCH GỘP: kiểm tra voter hợp lệ + phiếu mã hóa hợp lệ
// ======================================================

template VotingCircuit(depth, nCandidates) {
    // ---------- INPUTS ----------
    // 1️⃣ Inputs cho ProofKeyRelation
    signal input sk;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input root;
    signal input hash_pk;
    signal input election_hash;

    // 2️⃣ Inputs cho MultiCiphertextValidity
    signal input PKx;
    signal input PKy;
    signal input r[nCandidates];
    signal input m[nCandidates];
    signal input C1x[nCandidates];
    signal input C1y[nCandidates];
    signal input C2x[nCandidates];
    signal input C2y[nCandidates];

    // ---------- OUTPUTS ----------
    signal output nullifier;       // chống double vote
    signal output hashCipherAll;   // cam kết toàn bộ ciphertext
    // signal output globalCommit;    // hash tổng hợp để lưu on-chain

    // ---------- SUBCIRCUITS ----------
    // 1️⃣ Xác minh voter có trong Merkle tree (ProofKeyRelation)
    component voter = VoterValidity(depth);
    voter.sk <== sk;
    for (var i = 0; i < depth; i++) {
        voter.pathElements[i] <== pathElements[i];
        voter.pathIndices[i] <== pathIndices[i];
    }
    voter.root <== root;
    voter.hash_pk <== hash_pk;
    voter.election_hash <== election_hash;

    // 2️⃣ Kiểm tra phiếu mã hóa hợp lệ (MultiCiphertextValidity)
    component ballots = MultiCiphertextValidity(nCandidates);
    ballots.PKx <== PKx;
    ballots.PKy <== PKy;
    for (var j = 0; j < nCandidates; j++) {
        ballots.r[j] <== r[j];
        ballots.m[j] <== m[j];
        ballots.C1x[j] <== C1x[j];
        ballots.C1y[j] <== C1y[j];
        ballots.C2x[j] <== C2x[j];
        ballots.C2y[j] <== C2y[j];
    }

    // ---------- OUTPUT ASSIGN ----------
    nullifier <== voter.nullifier;
    hashCipherAll <== ballots.hashCipherAll;

    // ---------- HASH TỔNG HỢP ----------
    // Dùng Poseidon để kết hợp nullifier + hashCipherAll + root
    // component finalHash = Poseidon(3);
    // finalHash.inputs[0] <== voter.nullifier;
    // finalHash.inputs[1] <== ballots.hashCipherAll;
    // finalHash.inputs[2] <== root;
    // globalCommit <== finalHash.out;
}

// ======================================================
// Main instance
// ======================================================
component main = VotingCircuit(4, 2);
