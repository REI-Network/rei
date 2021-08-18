// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./IVariable.sol";

interface IKeeper is IVariable {
    function validator() external view returns (address);
}
