// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./IConfig.sol";

interface IOnly {
    function config() external view returns (IConfig);
}
