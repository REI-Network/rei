// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

interface IKeeper {
    function validator() external view returns (address);
}
