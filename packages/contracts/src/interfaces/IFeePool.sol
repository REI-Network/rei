// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

interface IFeePool {
    function earn(address validator, uint256 earned) external;

    function accumulate(bool isTxFee) external payable;

    function onAfterBlock() external;
}
