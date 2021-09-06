// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./IOnly.sol";

/**
 * @dev see {Fee}
 */
interface IFee is IOnly {
    /**
     * @dev `DepositInfo` records the information about deposit.
     */
    struct DepositInfo {
        uint256 amount;
        uint256 timestamp;
    }

    /**
     * @dev `DepositInfo` records the information about usage.
     *      If the timestamp interval is less than `feeRecoverInterval`, the usage will accumulate,
     *      Otherwise it will be cleared
     */
    struct UsageInfo {
        uint256 usage;
        uint256 timestamp;
    }

    function userTotalAmount(address user) external view returns (uint256);

    function userUsage(address user) external view returns (uint256, uint256);

    function userDeposit(address user1, address user2) external view returns (uint256, uint256);

    function totalAmount() external view returns (uint256);

    function deposit(address user) external payable;

    function withdraw(uint256 amount, address user) external;

    function whetherPayOffDebt(address user, uint256 timestamp) external view returns (bool);

    function estimateFee(address user, uint256 timestamp) external view returns (uint256);

    function estimateUsage(UsageInfo calldata ui, uint256 timestamp) external view returns (uint256 usage);

    function consume(address user, uint256 usage) external;
}
