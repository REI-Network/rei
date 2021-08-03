// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.6.2;

import "./interfaces/IConfig.sol";

contract Config is IConfig {
    address private s;
    
    function setStakeManager(address _s) external {
        s = _s;
    }
    
    function stakeManager() external view override returns(address) {
        return s;
    }
    
    function unstakeDelay() external view override returns(uint256) {
        return 1 seconds;
    }
    
    function minStakeAmount() external view override returns(uint256) {
        return 10;
    }
    
    function minUnstakeAmount() external view override returns(uint256) {
        return 5;
    }
    
    function getFactorByReason(uint8 reason) external view override returns(uint8) {
        return 40;
    }
    
    function amountPerVotingPower() external view override returns(uint256) {
        return 1;
    }
}