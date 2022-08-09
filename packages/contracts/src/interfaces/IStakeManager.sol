// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./IOnly.sol";

/**
 * @dev `Unstake` records the information of each unstake request.
 */
struct Unstake {
    // validator address
    address validator;
    // REI receiver address
    address payable to;
    // number of shares
    uint256 unstakeShares;
    // release timestamp
    uint256 timestamp;
}

/**
 * @dev `Validator` records the information of each validator.
 */
struct Validator {
    // validator unique id
    uint256 id;
    // commission share contract address
    address commissionShare;
    // commission rate
    uint256 commissionRate;
    // latest commission rate update timestamp
    uint256 updateTimestamp;
}

/**
 * @dev `ActiveValidator` records the information of each active validator,
 *      it will be updated by system in `StakeManager.afterBlock`.
 */
struct ActiveValidator {
    // validator address
    address validator;
    // proposer priority
    int256 priority;
}

/**
 * @dev see {StakeManager}
 */
interface IStakeManager is IOnly {
    function proposer() external view returns (address);

    function usedEvidence(bytes32 hash) external view returns (bool);

    function validatorId() external view returns (uint256);

    function validators(address validator)
        external
        view
        returns (
            uint256,
            address,
            uint256,
            uint256
        );

    function unstakeId() external view returns (uint256);

    function unstakeQueue(uint256 id)
        external
        view
        returns (
            address,
            address payable,
            uint256,
            uint256
        );

    function totalLockedAmount() external view returns (uint256);

    function activeValidators(uint256 index) external view returns (address, int256);

    function indexedValidatorsLength() external view returns (uint256);

    function indexedValidatorsExists(uint256 id) external view returns (bool);

    function indexedValidatorsByIndex(uint256 index) external view returns (address);

    function indexedValidatorsById(uint256 id) external view returns (address);

    function getVotingPowerByIndex(uint256 index) external view returns (uint256);

    function getVotingPowerById(uint256 index) external view returns (uint256);

    function getVotingPowerByAddress(address validator) external view returns (uint256);

    function getTotalLockedAmountAndValidatorCount(address[] calldata excludes) external view returns (uint256, uint256);

    function activeValidatorsLength() external view returns (uint256);

    function estimateSharesToAmount(address validator, uint256 shares) external view returns (uint256);

    function estimateAmountToShares(address validator, uint256 amount) external view returns (uint256);

    function estimateUnstakeAmount(address validator, uint256 shares) external view returns (uint256);

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

    function reward(address validator) external payable;

    function slash(
        address validator,
        uint8 reason,
        bytes32 hash
    ) external returns (uint256);

    function initEvidenceHash(bytes32[] calldata hashes) external;

    function onAfterBlock(
        address _proposer,
        address[] calldata acValidators,
        int256[] calldata priorities
    ) external;
}
