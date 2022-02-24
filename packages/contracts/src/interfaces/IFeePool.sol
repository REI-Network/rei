// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./IOnly.sol";

/**
 * @dev see {FeePool}
 */
interface IFeePool is IOnly {
    function sharesOf(address) external view returns (uint256);

    function totalShares() external view returns (uint256);

    function globalTimestamp() external view returns (uint256);

    function validators(uint256 index) external view returns (address);

    function validatorsLength() external view returns (uint256);

    function distribute(address validator, uint256 amount) external payable;
}
