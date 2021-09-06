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

    modifier onlyRouter() {
        require(msg.sender == config.router(), "Only: only router");
        _;
    }

    constructor(IConfig _config) public {
        config = _config;
    }
}
