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

    function userDeposit(address user1, address user2) external view returns (uint256, uint256);

    function deposit(address user) external payable;

    function withdraw(address user, uint256 amount) external;
}
