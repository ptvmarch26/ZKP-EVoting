// pragma circom 2.0.0;

// include "circomlib/circuits/babyjub.circom";
// include "circomlib/circuits/escalarmulany.circom";
// include "circomlib/circuits/escalarmulfix.circom";

// // Circuit chứng minh: số phiếu đếm được từ giải mã là đúng
// // Logic: M = votes * G (với G là base point của Baby Jubjub)
// template VerifyVoteCount() {
//     // ========== PUBLIC INPUTS ==========
//     signal input M_x;        // Điểm message sau giải mã (công khai)
//     signal input M_y;
//     signal input votes;      // Số phiếu claim (công khai)
    
//     // ========== CONSTRAINT ==========
//     // Chứng minh: M = votes * G
//     // Tức là điểm M phải bằng với base point nhân với số votes
    
//     component mulG = EscalarMulFix(254);
//     mulG.e <== votes;
    
//     // Verify kết quả
//     mulG.out[0] === M_x;
//     mulG.out[1] === M_y;
// }

// // Circuit đầy đủ: chứng minh cả quá trình giải mã + đếm phiếu
// template VerifyDecryptionAndCount() {
//     // ========== PUBLIC INPUTS ==========
//     signal input C1_x;       // Ciphertext tổng hợp C1
//     signal input C1_y;
//     signal input C2_x;       // Ciphertext tổng hợp C2
//     signal input C2_y;
//     signal input votes;      // Số phiếu đếm được (KẾT QUẢ CUỐI)
    
//     // ========== PRIVATE INPUTS ==========
//     signal input D1_x;       // Partial decryption từ trustee 1
//     signal input D1_y;
//     signal input D2_x;       // Partial decryption từ trustee 2
//     signal input D2_y;
//     signal input lambda1;    // Lagrange coefficient cho trustee 1
//     signal input lambda2;    // Lagrange coefficient cho trustee 2
    
//     // ========== BƯỚC 1: Tính sumD = λ1*D1 + λ2*D2 ==========
//     component scaleD1 = EscalarMulAny(254);
//     scaleD1.p[0] <== D1_x;
//     scaleD1.p[1] <== D1_y;
//     scaleD1.e <== lambda1;
    
//     component scaleD2 = EscalarMulAny(254);
//     scaleD2.p[0] <== D2_x;
//     scaleD2.p[1] <== D2_y;
//     scaleD2.e <== lambda2;
    
//     component addD = BabyAdd();
//     addD.x1 <== scaleD1.out[0];
//     addD.y1 <== scaleD1.out[1];
//     addD.x2 <== scaleD2.out[0];
//     addD.y2 <== scaleD2.out[1];
    
//     // ========== BƯỚC 2: Tính M = C2 - sumD ==========
//     signal negSumD_x <== -addD.xout;
    
//     component computeM = BabyAdd();
//     computeM.x1 <== C2_x;
//     computeM.y1 <== C2_y;
//     computeM.x2 <== negSumD_x;
//     computeM.y2 <== addD.yout;
    
//     // ========== BƯỚC 3: Verify M = votes * G ==========
//     component verifyVotes = EscalarMulFix(254);
//     verifyVotes.e <== votes;
    
//     verifyVotes.out[0] === computeM.xout;
//     verifyVotes.out[1] === computeM.yout;
// }

// // Circuit đơn giản nhất: chỉ verify M đã biết
// template SimpleVerifyVotes() {
//     signal input M_x;
//     signal input M_y;
//     signal input votes;
    
//     component check = EscalarMulFix(254);
//     check.e <== votes;
//     check.out[0] === M_x;
//     check.out[1] === M_y;
// }

// component main = VerifyDecryptionAndCount();

pragma circom 2.1.5;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/bitify.circom";

/**
 * Verify that:
 *     M = C2_total - Σ (λ_i * D_i)
 * 
 * Works for threshold ElGamal decryption on BabyJubjub curve
 * using Lagrange interpolation.
 */
template TallyValidity(nTrustees) {
    // ===============================
    // 🔹 INPUTS
    // ===============================
    signal input C2_total_x;
    signal input C2_total_y;

    signal input D_x[nTrustees];
    signal input D_y[nTrustees];
    signal input lambda[nTrustees]; // hệ số Lagrange

    // ✅ plaintext M mà Aggregator đã tính được off-chain
    signal input Mx;
    signal input My;

    // ===============================
    // 🔹 COMPONENTS
    // ===============================
    component bits[nTrustees];
    component mulD[nTrustees];
    component addD[nTrustees];
    component finalSub = BabyAdd();

    // ===============================
    // 🔹 ACCUMULATORS
    // ===============================
    signal accD_x[nTrustees + 1];
    signal accD_y[nTrustees + 1];

    // Điểm khởi đầu = điểm trung hòa (0,1)
    accD_x[0] <== 0;
    accD_y[0] <== 1;

    // ===============================
    // 🔹 LOGIC: Tổng D = Σ (λ_i * D_i)
    // ===============================
    for (var i = 0; i < nTrustees; i++) {
        // 1️⃣ Chuyển lambda[i] thành bit array (little endian)
        bits[i] = Num2Bits(253);
        bits[i].in <== lambda[i];

        // 2️⃣ Nhân vô hướng D_i * lambda_i
        mulD[i] = EscalarMulAny(253);
        for (var j = 0; j < 253; j++) {
            mulD[i].e[j] <== bits[i].out[j];
        }
        mulD[i].p[0] <== D_x[i];
        mulD[i].p[1] <== D_y[i];

        // 3️⃣ Cộng dồn vào accumulator
        addD[i] = BabyAdd();
        addD[i].x1 <== accD_x[i];
        addD[i].y1 <== accD_y[i];
        addD[i].x2 <== mulD[i].out[0];
        addD[i].y2 <== mulD[i].out[1];

        accD_x[i + 1] <== addD[i].xout;
        accD_y[i + 1] <== addD[i].yout;
    }

    // Tổng D = Σ λ_i·D_i
    signal Dsum_x <== accD_x[nTrustees];
    signal Dsum_y <== accD_y[nTrustees];

    // ===============================
    // 🔹 M = C2_total - D_sum
    // Trên twisted Edwards: -(x, y) = (-x, y)
    // ===============================
    signal negD_x <== -Dsum_x;

    finalSub.x1 <== C2_total_x;
    finalSub.y1 <== C2_total_y;
    finalSub.x2 <== negD_x;   // đảo x
    finalSub.y2 <== Dsum_y;   // giữ y

    // ===============================
    // 🔹 Output kết quả
    // ===============================
    finalSub.xout === Mx;
    finalSub.yout === My;

    // (Optional) Debug checks:
    // assert(Dsum_x * Dsum_y != 0); // tránh trivial
}

// component main = TallyValidity(2);

template BatchTallyValidity(nTrustees, nCandidates) {
    // ===============================
    // 🔹 INPUTS (Giờ là mảng)
    // ===============================

    // Dữ liệu cho từng candidate
    signal input C2_total_x[nCandidates];
    signal input C2_total_y[nCandidates];
    signal input Mx[nCandidates];
    signal input My[nCandidates];

    // Dữ liệu giải mã (Decryption shares)
    // D_i = s_i * C1_total. C1_total sẽ khác nhau cho mỗi candidate
    // nên mảng D cũng sẽ có 2 chiều [candidate][trustee]
    signal input D_x[nCandidates][nTrustees];
    signal input D_y[nCandidates][nTrustees];

    // Hệ số Lagrange là hằng số cho bộ trustee
    signal input lambda[nTrustees];
    signal output valid;

    // ===============================
    // 🔹 LOGIC
    // ===============================
    
    // Tạo mảng component
    component tallyChecks[nCandidates];

    for (var j = 0; j < nCandidates; j++) {
        // 1. Khởi tạo một sub-circuit cho mỗi candidate
        tallyChecks[j] = TallyValidity(nTrustees);

        // 2. Nối dây (wire) inputs cho candidate thứ j
        tallyChecks[j].C2_total_x <== C2_total_x[j];
        tallyChecks[j].C2_total_y <== C2_total_y[j];
        tallyChecks[j].Mx <== Mx[j];
        tallyChecks[j].My <== My[j];

        // 3. Nối dây inputs của các trustee cho candidate thứ j
        for (var i = 0; i < nTrustees; i++) {
            tallyChecks[j].D_x[i] <== D_x[j][i];
            tallyChecks[j].D_y[i] <== D_y[j][i];
            tallyChecks[j].lambda[i] <== lambda[i];
        }
    }

    valid <== 1;
}

component main = BatchTallyValidity(2, 2);