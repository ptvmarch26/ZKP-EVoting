/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32", // cho Windows; Linux vẫn ok
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function ensureFile(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function buildOneCircuit({ circuitName, circuitsDir, buildRoot, ptauPath }) {
  const circuitFile = path.join(circuitsDir, `${circuitName}.circom`);
  ensureFile(circuitFile);
  ensureFile(ptauPath);

  // Mỗi mạch 1 folder riêng => khỏi lộn
  const outDir = path.join(buildRoot, circuitName);
  ensureDir(outDir);

  const r1cs = path.join(outDir, `${circuitName}.r1cs`);
  const sym = path.join(outDir, `${circuitName}.sym`);
  const wasm = path.join(outDir, `${circuitName}_js`, `${circuitName}.wasm`);

  const zkey0 = path.join(outDir, `${circuitName}_0000.zkey`);
  const zkey = path.join(outDir, `${circuitName}.zkey`);
  const vkey = path.join(outDir, `${circuitName}_vkey.json`);

  console.log(`\n==============================`);
  console.log(`Circuit: ${circuitName}`);
  console.log(`Input : ${circuitFile}`);
  console.log(`Output: ${outDir}`);
  console.log(`PTAU  : ${ptauPath}`);
  console.log(`==============================`);

  // 1) circom compile
  run("circom", [
    circuitFile,
    "--r1cs",
    "--wasm",
    "--sym",
    "-l",
    "node_modules",
    "-l",
    circuitsDir,
    "-o",
    outDir,
  ]);

  ensureFile(r1cs);
  ensureFile(sym);
  ensureFile(wasm);

  // 2) info (optional nhưng tiện check constraints)
  run("npx", ["snarkjs", "r1cs", "info", r1cs]);

  // 3) groth16 setup
  run("npx", ["snarkjs", "groth16", "setup", r1cs, ptauPath, zkey0]);
  ensureFile(zkey0);

  // 4) contribute (sẽ hỏi bạn nhập entropy trong terminal)
  run("npx", [
    "snarkjs",
    "zkey",
    "contribute",
    zkey0,
    zkey,
    "--name=key1",
    "-v",
  ]);
  ensureFile(zkey);

  // 5) export verification key
  run("npx", ["snarkjs", "zkey", "export", "verificationkey", zkey, vkey]);
  ensureFile(vkey);

  // 6) verify zkey
  run("npx", ["snarkjs", "zkey", "verify", r1cs, ptauPath, zkey]);

  console.log(`\n✅ DONE: ${circuitName}`);
  console.log(`- WASM: ${wasm}`);
  console.log(`- ZKEY: ${zkey}`);
  console.log(`- VKEY: ${vkey}`);

  return { outDir, wasm, zkey, vkey, r1cs };
}

function parseArgs() {
  // Usage:
  // node scripts/build_zk_artifacts.js VoteProofCombined CiphertextValidity
  // Optional env:
  // PTAU=circuits/powersOfTau28_hez_final_16.ptau
  // CIRCUITS_DIR=circuits
  // BUILD_DIR=circuits/build
  const circuitsDir = process.env.CIRCUITS_DIR || "circuits";
  const buildRoot = process.env.BUILD_DIR || path.join("circuits", "build");
  const ptauPath =
    process.env.PTAU || path.join("circuits", "powersOfTau28_hez_final_16.ptau");

  const circuits = process.argv.slice(2);
  if (circuits.length === 0) {
    // default theo repo bạn
    circuits.push("PartialDecryption");
  }

  return { circuitsDir, buildRoot, ptauPath, circuits };
}

async function main() {
  const { circuitsDir, buildRoot, ptauPath, circuits } = parseArgs();

  ensureDir(buildRoot);

  console.log("== Config ==");
  console.log("CIRCUITS_DIR:", circuitsDir);
  console.log("BUILD_DIR   :", buildRoot);
  console.log("PTAU        :", ptauPath);
  console.log("CIRCUITS    :", circuits.join(", "));

  for (const circuitName of circuits) {
    buildOneCircuit({ circuitName, circuitsDir, buildRoot, ptauPath });
  }

  console.log("\n🎉 All done.");
}

main().catch((e) => {
  console.error("\n❌ ERROR:", e.message || e);
  process.exit(1);
});
