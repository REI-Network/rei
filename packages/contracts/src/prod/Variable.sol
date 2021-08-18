// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../interfaces/IConfig.sol";

abstract contract Variable {
    using SafeMath for uint256;

    IConfig public config;

    modifier onlyStakeManager() {
        require(msg.sender == config.stakeManager(), "Variable: only stake manager");
        _;
    }

    constructor(address _config) public {
        config = IConfig(_config);
    }

    /**
     * @dev Reward validator, only can be called by stake manager
     */
    function reward() external payable onlyStakeManager {}

    /**
     * @dev Slash validator by factor, only can be called by stake manager
     */
    function slash(uint8 factor) external onlyStakeManager returns (uint256 amount) {
        require(factor <= 100, "Variable: invalid factor");
        amount = address(this).balance.mul(factor).div(100);
        if (amount > 0) {
            msg.sender.transfer(amount);
        }
    }
}
