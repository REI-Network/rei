// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IConfig.sol";
import "./interfaces/IOnly.sol";

abstract contract Only is IOnly {
    IConfig public override config;

    modifier onlyStakeManager() {
        require(msg.sender == config.stakeManager(), "Only: only stake manager");
        _;
    }

    modifier onlySystemCaller() {
        require(msg.sender == config.systemCaller(), "Only: only system caller");
        _;
    }

    constructor(IConfig _config) public {
        require(address(_config) != address(0), "Only: invalid config");
        config = _config;
    }
}
