// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./IOnly.sol";

/**
 * @dev see {ValidatorRewardManager}
 */
interface IValidatorRewardManager is IOnly {
    function balanceOf(address validator) external view returns (uint256 amount);

    function claim(address validator, uint256 amount) external;

    function reward(address validator) external payable;

    function slash(address validator, uint8 factor) external returns (uint256 amount);
}
