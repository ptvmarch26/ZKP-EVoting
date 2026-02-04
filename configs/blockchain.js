// const { ethers } = require("ethers");
// const electionABI = require("../artifacts/contracts/E_Voting.sol/E_Voting.json");

// const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

// const wallet = new ethers.Wallet(
//   "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
//   provider,
// );

// const CONTRACT_ADDRESS = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";

// const contract = new ethers.Contract(CONTRACT_ADDRESS, electionABI.abi, wallet);

// module.exports = { provider, wallet, contract };

const hre = require("hardhat");

const CONTRACT_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";

async function getContract() {
  const [signer] = await hre.ethers.getSigners();

  const abi = require("../artifacts/contracts/E_Voting.sol/E_Voting.json").abi;

  const contract = new hre.ethers.Contract(
    CONTRACT_ADDRESS,
    abi,
    signer
  );

  return { contract, signer };
}

module.exports = { getContract };
