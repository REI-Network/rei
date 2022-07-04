// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./IOnly.sol";

interface IEvidenceStorage is IOnly {
    function evidence(bytes32 hash) external view returns (bool);

    function evidenceList(uint256 index) external view returns (bytes memory);

    function evidenceListLength() external view returns (uint256);

    function addCommittedEvidence(bytes[] calldata evList) external;
}
