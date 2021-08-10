// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./IKeeper.sol";

interface IValidatorKeeper is IKeeper {
    function claim(uint256 amount, address payable to) external;
}
