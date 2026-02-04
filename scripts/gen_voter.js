import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import * as secp from "@noble/secp256k1";
import { buildEddsa, buildPoseidon } from "circomlibjs";

const { bytesToHex } = secp.etc;

// === CÁC HÀM TẠO KEY (TỪ FILE UTILS CỦA BẠN) ===

/**
 * Hàm helper để tạo số BigInt ngẫu nhiên
 */
function randomBigInt(modulus) {
  let rand;
  const nbytes = Math.ceil(modulus.toString(2).length / 8);
  do {
    rand = BigInt("0x" + randomBytes(nbytes).toString("hex"));
  } while (rand >= modulus || rand === 0n);
  return rand;
}

/**
 * Tạo cặp key secp256k1
 */
export const generateSecpKeys = () => {
  const sk = secp.utils.randomSecretKey();
  const pk = secp.getPublicKey(sk);
  const skHex = bytesToHex(sk);
  const pkHex = bytesToHex(pk);
  return { skHex, pkHex };
};

/**
 * Tạo cặp key BabyJubJub
 */
export const generateBabyJubJubKeys = (eddsa) => {
  const babyjub = eddsa.babyJub;
  const F = babyjub.F;
  const subOrder = BigInt(babyjub.subOrder.toString());

  const sk = randomBigInt(subOrder); // Đây là sk_bjj
  const pkPoint = babyjub.mulPointEscalar(babyjub.Base8, sk);
  const pk = [F.toObject(pkPoint[0]), F.toObject(pkPoint[1])]; // Đây là pk_bjj

  return {
    sk: sk.toString(),
    pk: pk.map((v) => v.toString()),
  };
};

// === HÀM MAIN ĐỂ CHẠY SCRIPT ===

async function main() {
  // === Cấu hình ===
  const NUM_VOTERS_TO_GENERATE = 10; // Thay đổi số lượng bạn muốn
  const ELECTION_ID = "ELC2024"; // ID cuộc bầu cử
  // =================

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Đặt tên cho 2 file output
  const outputDbJsonPath = path.join(
  __dirname,
  "..",
  "data",
  `voter_data_for_db_${NUM_VOTERS_TO_GENERATE}.json`
);

const outputScriptJsonPath = path.join(
  __dirname,
  "..",
  "data",
  `voter_secrets_for_script_${NUM_VOTERS_TO_GENERATE}.json`
);

  console.log("⚙️  Initializing circomlibjs (eddsa + poseidon)...");
  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();
  const F = eddsa.babyJub.F; // Dùng F của eddsa (giống poseidon.F)
  console.log("✅ Initialization complete.");

  // === MỚI: Tính ELECTION_HASH (Dựa trên logic handleVoteFlow) ===
  // Đây là logic hash string "ELC2024"
  // component nullifierHash = Poseidon(2);
  // nullifierHash.inputs[0] <== sk;
  // nullifierHash.inputs[1] <== election_hash;
  console.log(`Calculating election_hash for ID: "${ELECTION_ID}"...`);
  const elecBytes = Array.from(ELECTION_ID).map((c) => BigInt(c.charCodeAt(0)));
  const electionHashFp = poseidon(elecBytes);
  const election_hash = F.toObject(electionHashFp).toString();
  console.log(`✅ Election Hash: ${election_hash}`);
  // =============================================================

  const dbDataList = [];
  const secretDataList = [];

  console.log(`🚀 Generating data for ${NUM_VOTERS_TO_GENERATE} voters...`);

  for (let i = 0; i < NUM_VOTERS_TO_GENERATE; i++) {
    // 1. Tạo key secp256k1
    const { pkHex: pk_secp } = generateSecpKeys();

    // 2. Tạo key BabyJubJub (Lấy cả sk và pk)
    const { sk: sk_bjj, pk: pk_bjj } = generateBabyJubJubKeys(eddsa);

    // 3. Tính toán hashed_key (từ pk_bjj, để làm leaf)
    //    logic: Poseidon([pk_bjj[0], pk_bjj[1]])
    const pk_bjj_bigint = [BigInt(pk_bjj[0]), BigInt(pk_bjj[1])];
    const hashedKeyFp = poseidon(pk_bjj_bigint);
    const hashedKey = F.toObject(hashedKeyFp).toString();

    // === MỚI: Tính NULLIFIER (Dựa trên logic Circom) ===
    //     logic: Poseidon([sk_bjj, election_hash])
    const nullifierInputs = [BigInt(sk_bjj), BigInt(election_hash)];
    const nullifierFp = poseidon(nullifierInputs); // Đây là Poseidon(2)
    const nullifier = F.toObject(nullifierFp).toString();
    // ===================================================

    // 4. Tạo đối tượng cho File 1 (Database)
    const voterEntry_DB = {
      hashed_key: hashedKey,
      election_id: ELECTION_ID,
      is_valid: true,
      pk_secp: pk_secp,
    };
    dbDataList.push(voterEntry_DB);

    // 5. Tạo đối tượng cho File 2 (Script Test Vote)
    const voterEntry_Secret = {
      hashed_key: hashedKey, // Dùng để map với data DB
      sk_bjj: sk_bjj,
      pk_bjj: pk_bjj,
      pk_secp: pk_secp,
      nullifier: nullifier, // <-- ĐÃ THÊM
      election_hash: election_hash, // <-- Thêm luôn để file script dễ sử dụng
    };
    secretDataList.push(voterEntry_Secret);

    if ((i + 1) % 20 === 0) {
      console.log(`... Generated ${i + 1}/${NUM_VOTERS_TO_GENERATE}`);
    }
  }

  // 6. Ghi kết quả ra 2 file JSON
  fs.writeFileSync(
    outputDbJsonPath,
    JSON.stringify(dbDataList, null, 2),
    "utf8",
  );
  console.log(
    `\n💾 [File 1] Wrote ${dbDataList.length} voters to ${path.basename(
      outputDbJsonPath,
    )}`,
  );

  fs.writeFileSync(
    outputScriptJsonPath,
    JSON.stringify(secretDataList, null, 2),
    "utf8",
  );
  console.log(
    `💾 [File 2] Wrote ${
      secretDataList.length
    } voter secrets to ${path.basename(outputScriptJsonPath)}`,
  );

  console.log("🎉 Done!");
}

// Run script
main().catch((err) => {
  console.error("❌ An error occurred:", err);
  process.exit(1);
});
