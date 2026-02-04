pragma circom 2.1.5;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

template VoterValidity(depth) {
    // Private inputs
    signal input sk;             
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // Public inputs
    signal input root;         
    signal input hash_pk;      
    signal input election_hash;

    // ... (Phần 1 và 2 không đổi) ...
    component gen = BabyPbk();
    gen.in <== sk;

    component pkHash = Poseidon(2);
    pkHash.inputs[0] <== gen.Ax;
    pkHash.inputs[1] <== gen.Ay;

    pkHash.out === hash_pk;

    signal cur[depth + 1];
    cur[0] <== hash_pk;

    // 3. Hash dần lên root
    component h[depth];
    component mux[depth][2];
    
    // 💡 KHAI BÁO MẢNG TÍN HIỆU Ở NGOÀI VÒNG LẶP
    signal left[depth];
    signal right[depth];

    for (var i = 0; i < depth; i++) {
        // Mux để quyết định đâu là left, đâu là right
        mux[i][0] = Mux1();
        mux[i][0].c[0] <== cur[i];
        mux[i][0].c[1] <== pathElements[i];
        mux[i][0].s <== pathIndices[i];
        
        // 💡 GÁN GIÁ TRỊ VÀO PHẦN TỬ CỦA MẢNG, KHÔNG DÙNG "signal"
        left[i] <== mux[i][0].out;

        mux[i][1] = Mux1();
        mux[i][1].c[0] <== pathElements[i];
        mux[i][1].c[1] <== cur[i];
        mux[i][1].s <== pathIndices[i];
        
        // 💡 GÁN GIÁ TRỊ VÀO PHẦN TỬ CỦA MẢNG, KHÔNG DÙNG "signal"
        right[i] <== mux[i][1].out;

        // Hash với thứ tự đúng
        h[i] = Poseidon(2);
        h[i].inputs[0] <== left[i]; // Dùng phần tử thứ i
        h[i].inputs[1] <== right[i]; // Dùng phần tử thứ i
        cur[i + 1] <== h[i].out;
    }

    // 4. Check root
    root === cur[depth];

    // Nulifier chống double vote
    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== sk;
    nullifierHash.inputs[1] <== election_hash;

    signal output nullifier;
    nullifier <== nullifierHash.out;
}

// component main = VoterValidity(3);