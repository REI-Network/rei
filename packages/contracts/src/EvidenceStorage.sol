// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IEvidenceStorage.sol";
import "./Only.sol";

contract EvidenceStorage is Only, IEvidenceStorage {
    // a set of hashes holding all the evidence hash
    mapping(bytes32 => bool) public override evidence;
    // RLP serialized evidence list
    bytes[] internal evidenceList_;

    constructor(IConfig config) public Only(config) {}

    /**
     * Get evidence by index
     * @param index         Evidence index
     */
    function evidenceList(uint256 index) external view override returns (bytes memory) {
        return evidenceList_[index];
    }

    /**
     * Get evidence list length
     */
    function evidenceListLength() external view override returns (uint256) {
        return evidenceList_.length;
    }

    /**
     * Add committed evidence to storage
     * @param evList        RLP serialized evidence list
     */
    function addCommittedEvidence(bytes[] calldata evList) external override onlySystemCaller {
        for (uint256 i = 0; i < evList.length; i++) {
            bytes32 hash = keccak256(evList[i]);
            require(!evidence[hash], "EvidenceStorage: committed evidence");
            evidence[hash] = true;
            evidenceList_.push(evList[i]);
        }
    }
}
