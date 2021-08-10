// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IConfig.sol";

contract Keeper {
    IConfig public config;

    address private _validator;

    modifier onlyStakeManager() {
        require(msg.sender == config.stakeManager(), "Keeper: only stake manager");
        _;
    }

    constructor(address _config, address validator) public {
        config = IConfig(_config);
        _validator = validator;
    }

    /**
     * @dev Get validator address
     */
    function validator() external view returns (address) {
        return _validator;
    }

    /**
     * @dev Withdraw balance
     */
    function claim(uint256 amount, address payable to) external onlyStakeManager {
        require(address(this).balance >= amount, "Keeper: insufficient balance");
        to.transfer(amount);
    }
}
