// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

struct Unstake {
    address validator;
    address payable to;
    uint256 unstakeShares;
    uint256 timestamp;
}

struct Validator {
    uint256 id;
    address validatorKeeper;
    address commissionShare;
    address unstakeKeeper;
    uint256 commissionRate;
    uint256 updateTimestamp;
}

interface IStakeManager {
    function validators(address validator) external view returns (Validator memory);

    function indexedValidatorsLength() external view returns (uint256);

    function indexedValidatorsByIndex(uint256 index) external view returns (address);

    function indexedValidatorsById(uint256 id) external view returns (address);

    function getVotingPowerByIndex(uint256 index) external view returns (uint256);

    function getVotingPowerById(uint256 index) external view returns (uint256);

    function getVotingPowerByAddess(address validator) external view returns (uint256);

    function firstUnstakeId() external view returns (uint256);

    function lastUnstakeId() external view returns (uint256);

    function unstakeQueue(uint256 index) external view returns (Unstake memory);

    function estimateMinStakeAmount(address validator) external view returns (uint256);

    function estimateStakeAmount(address validator, uint256 shares) external view returns (uint256);

    function estimateMinUnstakeShares(address validator) external view returns (uint256);

    function estimateUnstakeShares(address validator, uint256 amount) external view returns (uint256);

    function estimateUnstakeAmount(address validator, uint256 shares) external view returns (uint256);

    function stake(address validator, address to) external payable returns (uint256);

    function startUnstake(
        address validator,
        address payable to,
        uint256 shares
    ) external returns (uint256);

    function startClaim(address payable to, uint256 amount) external returns (uint256);

    function setCommissionRate(uint256 rate) external;

    function doUnstake() external;
}
