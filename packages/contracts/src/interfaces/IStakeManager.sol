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

struct ActiveValidator {
    address validator;
    int256 priority;
}

interface IStakeManager {
    function estimator() external view returns (address);

    function validators(address validator) external view returns (Validator memory);

    function indexedValidatorsLength() external view returns (uint256);

    function indexedValidatorsExists(uint256 id) external view returns (bool);

    function indexedValidatorsByIndex(uint256 index) external view returns (address);

    function indexedValidatorsById(uint256 id) external view returns (address);

    function getVotingPowerByIndex(uint256 index) external view returns (uint256);

    function getVotingPowerById(uint256 index) external view returns (uint256);

    function getVotingPowerByAddress(address validator) external view returns (uint256);

    function unstakeQueue(uint256 index) external view returns (Unstake memory);

    function activeValidatorsLength() external view returns (uint256);

    function activeValidators(uint256 index) external view returns (ActiveValidator memory);

    function stake(address validator, address to) external payable returns (uint256);

    function startUnstake(
        address validator,
        address payable to,
        uint256 shares
    ) external returns (uint256);

    function startClaim(address payable to, uint256 amount) external returns (uint256);

    function setCommissionRate(uint256 rate) external;

    function unstake(uint256 id) external returns (uint256);

    function removeIndexedValidator(address validator) external;

    function addIndexedValidator(address validator) external;

    function afterBlock(
        address validator,
        address[] calldata acValidators,
        int256[] calldata priorities
    ) external payable;
}
