// pragma circom 2.1.5;
// include "circomlib/circuits/babyjub.circom";

// template DecryptionValidity() {
//     // --- Inputs ---
//     signal input C1x;
//     signal input C1y;
//     signal input C2x;
//     signal input C2y;
//     signal input Mx;
//     signal input My; // Điểm plaintext (G * m)
//     signal input PKx;
//     signal input PKy;

//     // --- Witness ---
//     signal private input sk; // bí mật chỉ trustee biết

//     // --- Constraints ---
//     // 1️⃣ Kiểm tra PK = sk * G
//     component mul1 = BabyMul();
//     mul1.P[0] <== 0;
//     mul1.P[1] <== 1;
//     mul1.e <== sk;
//     PKx === mul1.out[0];
//     PKy === mul1.out[1];

//     // 2️⃣ Kiểm tra M = C2 - sk*C1
//     component mul2 = BabyMul();
//     mul2.P[0] <== C1x;
//     mul2.P[1] <== C1y;
//     mul2.e <== sk;

//     signal negSkC1x = mul2.out[0];
//     signal negSkC1y = F.neg(mul2.out[1]);

//     component add = BabyAdd();
//     add.x1 <== C2x;
//     add.y1 <== C2y;
//     add.x2 <== negSkC1x;
//     add.y2 <== negSkC1y;

//     Mx === add.xout;
//     My === add.yout;
// }

// component main = DecryptionValidity();


pragma circom 2.1.5;

// ======================= IMPORT =======================
include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/escalarmulfix.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/bitify.circom";

// ======================================================
// MẠCH KIỂM CHỨNG PHẦN GIẢI MÃ D_i = s_i * C1
// ======================================================

template PartialDecryptionProof() {
    // ---------- INPUTS ----------
    // Điểm C1 từ ciphertext
    signal input C1x;
    signal input C1y;

    // Kết quả D_i do thành viên i công bố
    signal input D_ix;
    signal input D_iy;

    // Public key của thành viên i
    signal input PKx;
    signal input PKy;

    // ---------- WITNESS ----------
    // Khóa bí mật của thành viên i
    signal input s_i;

    // ---------- RÀNG BUỘC ----------
    signal output valid;

    // 1️⃣ PK_i = s_i * G  (dùng BabyPbk vì điểm G cố định)
    component pbk = BabyPbk();
    pbk.in <== s_i;

    PKx === pbk.Ax;
    PKy === pbk.Ay;

    // 2️⃣ D_i = s_i * C1 (dùng EscalarMulAny vì C1 là điểm động)
    component bits = Num2Bits(253);
    bits.in <== s_i;

    component mul2 = EscalarMulAny(253);
    for (var i = 0; i < 253; i++) {
        mul2.e[i] <== bits.out[i];
    }

    // Gán điểm cơ sở (C1)
    mul2.p[0] <== C1x;
    mul2.p[1] <== C1y;

    // Ràng buộc kết quả nhân điểm
    D_ix === mul2.out[0];
    D_iy === mul2.out[1];

    valid <== 1;
}

// ---------------------- MAIN --------------------------
component main = PartialDecryptionProof();
