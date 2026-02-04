// pragma circom 2.1.5;

// include "circomlib/circuits/babyjub.circom";
// include "circomlib/circuits/poseidon.circom";
// include "circomlib/circuits/escalarmulfix.circom";
// include "circomlib/circuits/bitify.circom";

// /*
//  * Mạch tối ưu để chọn một điểm dựa trên một bit đầu vào.
//  * Nếu selector = 0, output = (0, 1) (điểm vô cùng).
//  * Nếu selector = 1, output = (in_x, in_y).
//  */
// template PointMux() {
//     signal input selector;
//     signal input in_x;
//     signal input in_y;
//     signal output out_x;
//     signal output out_y;

//     // Ràng buộc selector phải là 0 hoặc 1
//     selector * (1 - selector) === 0;

//     // out_x = selector * in_x + (1-selector) * 0 = selector * in_x
//     out_x <== selector * in_x;
//     // out_y = selector * (in_y - 1) + 1
//     out_y <== selector * (in_y - 1) + 1;
// }


// // ---------------------------------------------------
// // 1. Mạch kiểm tra 1 ciphertext hợp lệ (ĐÃ TỐI ƯU)
// // ---------------------------------------------------
// template CiphertextValidityOptimized() {
//     signal input r;
//     signal input m; // m phải là 0 hoặc 1

//     // PK cố định của hệ thống
//     var PK_POINT[2] = [
//         10561046947398942713006563848830222423239764578245530822875840708927273164748,
//         431661556484252089284164801767262986230833960338989343377426319424103389718
//     ];

//     signal input C1x;
//     signal input C1y;
//     signal input C2x;
//     signal input C2y;

//     var BASE8[2] = [
//         5299619240641551281634865583518297030282874472190772894086521144482721001553,
//         16950150798460657717958625567821834550301663161624707787222815936182638968203
//     ];

//     // Ràng buộc m phải là 0 hoặc 1
//     m * (1 - m) === 0;

//     // ---- Chia sẻ chung bit decomposition cho r ----
//     component rBits = Num2Bits(253);
//     rBits.in <== r;

//     // ---- C1 = r * G ----
//     component mulBase_r = EscalarMulFix(253, BASE8);
//     for (var i = 0; i < 253; i++) {
//         mulBase_r.e[i] <== rBits.out[i];
//     }
//     C1x === mulBase_r.out[0];
//     C1y === mulBase_r.out[1];

//     // ---- r * PK (PK cố định) ----
//     component mulPK = EscalarMulFix(253, PK_POINT);
//     for (var i = 0; i < 253; i++) {
//         mulPK.e[i] <== rBits.out[i];
//     }
//     signal rPK_x <== mulPK.out[0];
//     signal rPK_y <== mulPK.out[1];

//     // ---- m * G (Tối ưu bằng PointMux) ----
//     // Thay vì dùng EscalarMulFix tốn kém, ta dùng Mux để chọn.
//     component mG_mux = PointMux();
//     mG_mux.selector <== m;
//     mG_mux.in_x <== BASE8[0];
//     mG_mux.in_y <== BASE8[1];
    
//     signal mG_x <== mG_mux.out_x;
//     signal mG_y <== mG_mux.out_y;

//     // ---- C2 = mG + rPK ----
//     component addPoints = BabyAdd();
//     addPoints.x1 <== mG_x;
//     addPoints.y1 <== mG_y;
//     addPoints.x2 <== rPK_x;
//     addPoints.y2 <== rPK_y;

//     C2x === addPoints.xout;
//     C2y === addPoints.yout;

//     // ---- Hash ciphertext ----
//     component pose = Poseidon(4);
//     pose.inputs[0] <== C1x;
//     pose.inputs[1] <== C1y;
//     pose.inputs[2] <== C2x;
//     pose.inputs[3] <== C2y;

//     signal output hashCipher;
//     hashCipher <== pose.out;
// }

// // ---------------------------------------------------
// // 2. Mạch xử lý nhiều ciphertext (dùng mạch tối ưu)
// // ---------------------------------------------------
// template MultiCiphertextValidity(nCandidates) {
//     signal input r[nCandidates];
//     signal input m[nCandidates];
//     signal input C1x[nCandidates];
//     signal input C1y[nCandidates];
//     signal input C2x[nCandidates];
//     signal input C2y[nCandidates];

//     signal output hashCipherAll;

//     // Chuỗi hash chain
//     var FZERO = 0;
//     signal acc[nCandidates + 1];
//     acc[0] <== FZERO;

//     component ct[nCandidates];
//     component hashStep[nCandidates];

//     for (var i = 0; i < nCandidates; i++) {
//         ct[i] = CiphertextValidityOptimized();

//         ct[i].r <== r[i];
//         ct[i].m <== m[i];
//         ct[i].C1x <== C1x[i];
//         ct[i].C1y <== C1y[i];
//         ct[i].C2x <== C2x[i];
//         ct[i].C2y <== C2y[i];

//         hashStep[i] = Poseidon(2);
//         hashStep[i].inputs[0] <== acc[i];
//         hashStep[i].inputs[1] <== ct[i].hashCipher;
//         acc[i + 1] <== hashStep[i].out;
//     }

//     hashCipherAll <== acc[nCandidates];
// }

// // ---------------------------------------------------
// // 3. Mạch main
// // ---------------------------------------------------
// component main = MultiCiphertextValidity(10);


pragma circom 2.1.5;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/bitify.circom";

/*
 * Mạch chọn điểm dựa trên bit selector.
 * Nếu selector = 0 → output = (0, 1) (điểm vô cùng).
 * Nếu selector = 1 → output = (in_x, in_y).
 */
template PointMux() {
    signal input selector;
    signal input in_x;
    signal input in_y;
    signal output out_x;
    signal output out_y;

    // Ràng buộc selector phải là 0 hoặc 1
    selector * (1 - selector) === 0;

    // out_x = selector * in_x
    out_x <== selector * in_x;
    // out_y = selector * (in_y - 1) + 1
    out_y <== selector * (in_y - 1) + 1;
}

// ---------------------------------------------------
// 1️⃣ Mạch kiểm tra 1 ciphertext hợp lệ (PK là input động)
// ---------------------------------------------------
template CiphertextValidityOptimized() {
    signal input r;
    signal input m; // m ∈ {0,1}
    signal input PKx;
    signal input PKy;

    signal input C1x;
    signal input C1y;
    signal input C2x;
    signal input C2y;

    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];

    // Ràng buộc m phải là 0 hoặc 1
    m * (1 - m) === 0;

    // ---- Chia sẻ bit decomposition của r ----
    component rBits = Num2Bits(253);
    rBits.in <== r;

    // ---- C1 = r * G ----
    component mulBase_r = EscalarMulFix(253, BASE8);
    for (var i = 0; i < 253; i++) {
        mulBase_r.e[i] <== rBits.out[i];
    }
    C1x === mulBase_r.out[0];
    C1y === mulBase_r.out[1];

    // ---- r * PK (PK là input) ----
    component mulPK = EscalarMulAny(253);
    mulPK.p[0] <== PKx;
    mulPK.p[1] <== PKy;
    for (var i = 0; i < 253; i++) {
        mulPK.e[i] <== rBits.out[i];
    }
    signal rPK_x <== mulPK.out[0];
    signal rPK_y <== mulPK.out[1];

    // ---- m * G (dùng PointMux tối ưu) ----
    component mG_mux = PointMux();
    mG_mux.selector <== m;
    mG_mux.in_x <== BASE8[0];
    mG_mux.in_y <== BASE8[1];

    signal mG_x <== mG_mux.out_x;
    signal mG_y <== mG_mux.out_y;

    // ---- C2 = mG + rPK ----
    component addPoints = BabyAdd();
    addPoints.x1 <== mG_x;
    addPoints.y1 <== mG_y;
    addPoints.x2 <== rPK_x;
    addPoints.y2 <== rPK_y;

    C2x === addPoints.xout;
    C2y === addPoints.yout;

    // ---- Hash ciphertext ----
    component pose = Poseidon(4);
    pose.inputs[0] <== C1x;
    pose.inputs[1] <== C1y;
    pose.inputs[2] <== C2x;
    pose.inputs[3] <== C2y;

    signal output hashCipher;
    hashCipher <== pose.out;
}

// ---------------------------------------------------
// 2️⃣ Mạch xử lý nhiều ciphertext (multi-candidate)
// ---------------------------------------------------
template MultiCiphertextValidity(nCandidates) {
    signal input PKx;
    signal input PKy;
    signal input r[nCandidates];
    signal input m[nCandidates];
    signal input C1x[nCandidates];
    signal input C1y[nCandidates];
    signal input C2x[nCandidates];
    signal input C2y[nCandidates];

    signal output hashCipherAll;

    // Chuỗi hash chain
    var FZERO = 0;
    signal acc[nCandidates + 1];
    acc[0] <== FZERO;

    component ct[nCandidates];
    component hashStep[nCandidates];

    for (var i = 0; i < nCandidates; i++) {
        ct[i] = CiphertextValidityOptimized();
        ct[i].PKx <== PKx;
        ct[i].PKy <== PKy;
        ct[i].r <== r[i];
        ct[i].m <== m[i];
        ct[i].C1x <== C1x[i];
        ct[i].C1y <== C1y[i];
        ct[i].C2x <== C2x[i];
        ct[i].C2y <== C2y[i];

        hashStep[i] = Poseidon(2);
        hashStep[i].inputs[0] <== acc[i];
        hashStep[i].inputs[1] <== ct[i].hashCipher;
        acc[i + 1] <== hashStep[i].out;
    }

    hashCipherAll <== acc[nCandidates];
}

// ---------------------------------------------------
// 3️⃣ Mạch main
// ---------------------------------------------------
// component main = MultiCiphertextValidity(5);
