// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./IOnly.sol";

interface IFreeFee is IOnly {
    struct UsageInfo {
        uint256 usage;
        uint256 timestamp;
    }

    function estimateFreeFee(address user, uint256 timestamp) external view returns (uint256);

    function consume(address user, uint256 usage) external;

    function onAfterBlock() external;
}
