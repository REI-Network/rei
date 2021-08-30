// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IConfig.sol";

abstract contract Only {
    IConfig public config;

    modifier onlyStakeManager() {
        require(msg.sender == config.stakeManager(), "OnlyStakeManager: only stake manager");
        _;
    }

    modifier onlySystemCaller() {
        require(msg.sender == config.systemCaller(), "OnlyStakeManager: only system caller");
        _;
    }

    constructor(IConfig _config) public {
        config = _config;
    }
}
