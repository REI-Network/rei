// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IConfig.sol";

/**
 * Config contract for test
 */
contract DevConfig is Ownable, IConfig {
    address internal s = 0x0000000000000000000000000000000000001001;
    address internal c = 0x0000000000000000000000000000000000001002;
    address internal u = 0x0000000000000000000000000000000000001003;
    address internal v = 0x0000000000000000000000000000000000001004;

    uint256 internal ud = 1 seconds;
    uint256 internal mivp = 10000;
    uint256 internal scri = 5 seconds;

    /////////////////////////////////

    function setStakeManager(address _s) external onlyOwner {
        s = _s;
    }

    function setSystemCaller(address _c) external onlyOwner {
        c = _c;
    }

    function setUnstakePool(address _u) external onlyOwner {
        u = _u;
    }

    function setValidatorRewardPool(address _v) external onlyOwner {
        v = _v;
    }

    function setUnstakeDelay(uint256 _ud) external onlyOwner {
        ud = _ud;
    }

    function setMinIndexVotingPower(uint256 _mivp) external onlyOwner {
        mivp = _mivp;
    }

    function setSetCommissionRateInterval(uint256 _scri) external onlyOwner {
        scri = _scri;
    }

    /////////////////////////////////

    function stakeManager() external view override returns (address) {
        return s;
    }

    function systemCaller() external view override returns (address) {
        return c;
    }

    function unstakePool() external view override returns (address) {
        return u;
    }

    function validatorRewardPool() external view override returns (address) {
        return v;
    }

    function unstakeDelay() external view override returns (uint256) {
        return ud;
    }

    function minIndexVotingPower() external view override returns (uint256) {
        return mivp;
    }

    function setCommissionRateInterval() external view override returns (uint256) {
        return scri;
    }

    function getFactorByReason(uint8 reason) external view override returns (uint8) {
        if (reason == 0) {
            return 40;
        } else if (reason == 1) {
            return 100;
        } else {
            revert("Config: invalid reason");
        }
    }

    // a simple function to get blockchain timestamp for test
    function blockTimestamp() external view returns (uint256) {
        return block.timestamp;
    }
}
