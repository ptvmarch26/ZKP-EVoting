const { ethers } = require("ethers");
const electionABI = require("../artifacts/contracts/E_Voting.sol/E_Voting.json");

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:9545");

const wallet = new ethers.Wallet(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  provider,
);

const CONTRACT_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";

const contract = new ethers.Contract(CONTRACT_ADDRESS, electionABI.abi, wallet);

module.exports = { provider, wallet, contract };
