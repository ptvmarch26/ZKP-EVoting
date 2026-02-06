const hre = require("hardhat");

// ===== CONTRACT ADDRESSES =====
const VOTING_ADDRESS = "0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf";
const TALLY_VERIFIER_ADDRESS = "0x0E801D84Fa97b50751Dbf25036d067dCf18858bF"; 
// 👆 đổi đúng address TallyValidityVerifier của bạn

async function getContract(signerIndex = 0) {
  const signers = await hre.ethers.getSigners();
  const signer = signers[signerIndex];

  // ===== ABIs =====
  const votingAbi =
    require("../artifacts/contracts/E_Voting.sol/E_Voting.json").abi;

  const tallyVerifierAbi =
    require(
      "../artifacts/contracts/TallyVerifier.sol/TallyVerifierOnChain.json"
    ).abi;

  // ===== CONTRACT INSTANCES =====
  const votingContract = new hre.ethers.Contract(
    VOTING_ADDRESS,
    votingAbi,
    signer
  );

  const tallyVerifierContract = new hre.ethers.Contract(
    TALLY_VERIFIER_ADDRESS,
    tallyVerifierAbi,
    signer
  );

  return {
    signer,
    votingContract,
    tallyVerifierContract,
  };
}

module.exports = { getContract };
