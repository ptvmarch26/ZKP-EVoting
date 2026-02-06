const hre = require("hardhat");

// ===== CONTRACT ADDRESSES =====
const VOTING_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const TALLY_VERIFIER_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"; 
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
