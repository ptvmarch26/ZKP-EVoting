// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ParticialDecriptionVerifier.sol";

contract E_Voting is ParticialDecriptionVerifier{
    address public admin;

    enum ElectionStatus { Inactive, Active, Ended }

    struct ElectionInfo {
        string electionId;
        string name;
        uint startDate;
        uint endDate;
        ElectionStatus status;
        bytes32 merkleRoot;
    }


    struct Candidate {
        uint id;
        string name;
        uint voteCount;
    }


    ElectionInfo public info;
    Candidate[] public candidates;
    bytes public epk; // public encryption key (sau này từ DKG)

    event ElectionCreated(string electionId, string name);
    event MerkleRootUpdated(bytes32 root);
    event CandidateAdded(uint id, string name);
    event EpkPublished(bytes epk);
    event VotePublished(bytes32 indexed nullifier, bytes32 indexed hashCipher, string cid);
    constructor() {
        admin = msg.sender;
    }
    

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    modifier onlyActiveElection() {
        require(info.status == ElectionStatus.Active, "Election not active");
        _;
    }

    modifier onlyAggregator() {
        require(msg.sender == aggregator, "Not authorized (aggregator only)");
        _;
    }

    modifier onlyTrustee() {
        require(isTrustee[msg.sender], "Not trustee");
        _;
    }

    function setElectionInfo(
        string memory _id,
        string memory _name,
        uint _start,
        uint _end
    ) public onlyAdmin {
        info = ElectionInfo(_id, _name, _start, _end, ElectionStatus.Active, 0x0);
        emit ElectionCreated(_id, _name);
    }

    event ElectionEnded();

    function endElection() external onlyAdmin {
        require(info.status == ElectionStatus.Active, "Not active");
        info.status = ElectionStatus.Ended;
        emit ElectionEnded();
    }

    function setMerkleRoot(bytes32 _root) external onlyAdmin {
        info.merkleRoot = _root;
        emit MerkleRootUpdated(_root);
    }

    function addCandidate(string memory _name) public onlyAdmin {
        candidates.push(Candidate(candidates.length + 1, _name, 0));
        emit CandidateAdded(candidates.length, _name);
    }

    function publishEpk(bytes calldata _epk) external onlyAdmin {
        epk = _epk;
        emit EpkPublished(_epk);
    }

    // Getter cho số lượng ứng cử viên
    function getCandidateCount() public view returns (uint) {
        return candidates.length;
    }

    mapping(bytes32 => bool) public isNullifierUsed;



    function submitVote(bytes32 _nullifier, bytes32 _hashCipher, string calldata _cid) external onlyActiveElection{

        // 2️⃣ Chống double-vote
        require(!isNullifierUsed[_nullifier], "Double vote detected");

        // 3️⃣ Ghi nhận phiếu mới (chỉ hash)
        isNullifierUsed[_nullifier] = true;

        // 4️⃣ Phát event để Aggregator có thể query hashCipher
        emit VotePublished(_nullifier, _hashCipher, _cid);
    }


    // 🔒 BE publish hashOnChain sau khi hết hạn bỏ phiếu
    bytes32 public hashAllOnChain;
    event HashAllOnChainPublished(bytes32 hashAllOnChain);

    function publishHashAllOnChain(bytes32 _hashAllOnChain) external onlyAdmin {
        require(hashAllOnChain == 0x0, "Already published");
        hashAllOnChain = _hashAllOnChain;
        emit HashAllOnChainPublished(_hashAllOnChain);
    }

    // 📦 Aggregator nộp kết quả tổng hợp
    //bytes public finalCipher;
    //bytes32 public tallyProofHash;
    //event TallySubmitted(bytes C_total, bytes32 proofHash);

    //function submitTally(bytes calldata _C_total, bytes32 _proofHash) external onlyAdmin {
    //    require(hashOnChain != 0x0, "hashOnChain not set");
    //    finalCipher = _C_total;
    //    tallyProofHash = _proofHash;
    //    emit TallySubmitted(_C_total, _proofHash);
    //}

// ================= TRUSTEE DECRYPTION =================
struct PartialDecryption {
    uint256[2][] D_points; // danh sách D_i = [[x1,y1], [x2,y2], ...]
    bool verified;
}
// Mapping lưu phần giải mã của mỗi trustee
//mapping(address => PartialDecryption) public partialDecryptions;

// Danh sách trustee hợp lệ
mapping(address => bool) public isTrustee;
mapping(address => uint256) public trusteeID;

// Biến đếm số lượng trustee đã submit hợp lệ
uint256 public thresholdCount;
uint256 public constant minRequired = 2; // 2/3 trong tổng 3 trustee

// Event
event TrusteeRegistered(address indexed trustee);
event PartialDecryptionVerified(address indexed trustee);
event PartialDecryptionSubmitted(address indexed trustee, uint256[2][] D_points);
event AllTrusteesAgreed();

// Chỉ admin mới được đăng ký 3 trustee
function registerTrustees(address[3] calldata _trustees) external onlyAdmin {
    require(thresholdCount == 0, "Already initialized");
    for (uint i = 0; i < 3; i++) {
        isTrustee[_trustees[i]] = true;
        trusteeID[_trustees[i]] = i + 1; 
        emit TrusteeRegistered(_trustees[i]);
    }
}

// Hàm 1️⃣: verify proof — chỉ để kiểm tra proof hợp lệ (off-chain hoặc view)
mapping(address => bool) public lastVerifyPassed;
event PartialDecryptionFailed(address trustee);

// function verifyPartialProof(
//     uint[2] calldata pA,
//     uint[2][2] calldata pB,
//     uint[2] calldata pC,
//     uint[1] calldata pubSignals
// ) external onlyTrustee returns (bool) {

//     bool ok = _safeVerifyPartialProof(pA, pB, pC, pubSignals); // dùng wrapper

//     if (ok) {
//         lastVerifyPassed[msg.sender] = true;
//         emit PartialDecryptionVerified(msg.sender);
//     } else {
//         emit PartialDecryptionFailed(msg.sender);
//     }

//     return ok;
// }

function verifyPartialProof(
    uint[2] calldata pA,
    uint[2][2] calldata pB,
    uint[2] calldata pC,
    uint[1] calldata pubSignals
) external onlyTrustee {
    bool ok = _safeVerifyPartialProof(pA, pB, pC, pubSignals);
    require(ok, "Invalid ZK Proof");   // quan trọng
    lastVerifyPassed[msg.sender] = true;
    emit PartialDecryptionVerified(msg.sender);
}


function _safeVerifyPartialProof(
    uint[2] memory pA,
    uint[2][2] memory pB,
    uint[2] memory pC,
    uint[1] memory pubSignals
) internal view returns (bool) {
    (bool success, bytes memory result) = address(this).staticcall(
        abi.encodeWithSignature(
            "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[1])",
            pA, pB, pC, pubSignals
        )
    );
    if (!success || result.length < 32) return false;
    return abi.decode(result, (bool));
}

mapping(address => bool) public hasPublished;

// Hàm 2️⃣: publish dữ liệu giải mã — chỉ gọi được sau khi verify thành công
function publishPartialDecryption(
    uint256[2][] calldata D_points // mảng các cặp [D_ix, D_iy]
) external onlyTrustee {
    require(lastVerifyPassed[msg.sender], "Proof not verified");
    //require(!partialDecryptions[msg.sender].verified, "Already submitted");
    require(!hasPublished[msg.sender], "Already published");
    require(D_points.length > 0, "Empty D_points");


    // reset verify flag sau khi publish
    hasPublished[msg.sender] = true;
    lastVerifyPassed[msg.sender] = false;

    unchecked {
        thresholdCount++;
    }

    emit PartialDecryptionSubmitted(msg.sender, D_points);

    if (thresholdCount >= minRequired) {
        emit AllTrusteesAgreed();
    }
}   

// =================== AGGREGATOR PUBLISH CIPHERTEXT TOTAL ===================

address public aggregator;

event CipherTotalPublished(
    uint indexed candidateId,
    uint[2] C1_total,
    uint[2] C2_total
);

function setAggregator(address _aggregator) external onlyAdmin {
    require(_aggregator != address(0), "invalid aggregator");
    aggregator = _aggregator;
}


function publishAllCipherTotals(
    uint[2][] calldata C1_list,
    uint[2][] calldata C2_list
) external onlyAggregator {
    require(C1_list.length == C2_list.length, "Length mismatch");
    for (uint i = 0; i < C1_list.length; i++) {
        emit CipherTotalPublished(i + 1, C1_list[i], C2_list[i]);
    }
}
}
