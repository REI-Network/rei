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
    address internal f = 0x0000000000000000000000000000000000001005;
    address internal fp = 0x0000000000000000000000000000000000001006;
    address internal ft = 0x0000000000000000000000000000000000001007;
    address internal pr = 0x0000000000000000000000000000000000001008;

    uint256 internal ud = 1 seconds;
    uint256 internal wd = 1 seconds;
    uint256 internal mivp = 10000;
    uint256 internal scri = 5 seconds;
    uint256 internal fpi = 10 seconds;
    uint256 internal rap = 10;
    uint256 internal fft = 1e21;
    uint256 internal jtd = 10;

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

    function setFee(address _f) external onlyOwner {
        f = _f;
    }

    function setFeePool(address _fp) external onlyOwner {
        fp = _fp;
    }

    function setPrison(address _pr) external onlyOwner {
        pr = _pr;
    }

    function setUnstakeDelay(uint256 _ud) external onlyOwner {
        ud = _ud;
    }

    function setWithdrawDelay(uint256 _wd) external onlyOwner {
        wd = _wd;
    }

    function setMinIndexVotingPower(uint256 _mivp) external onlyOwner {
        mivp = _mivp;
    }

    function setSetCommissionRateInterval(uint256 _scri) external onlyOwner {
        scri = _scri;
    }

    function setFeePoolInterval(uint256 _fpi) external onlyOwner {
        fpi = _fpi;
    }

    function setRecordsAmountPeriod(uint256 _rap) external onlyOwner {
        rap = _rap;
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

    function fee() external view override returns (address) {
        return f;
    }

    function feePool() external view override returns (address) {
        return fp;
    }

    function feeToken() external view override returns (address) {
        return ft;
    }

    function prison() external view override returns (address) {
        return pr;
    }

    function unstakeDelay() external view override returns (uint256) {
        return ud;
    }

    function withdrawDelay() external view override returns (uint256) {
        return wd;
    }

    function minIndexVotingPower() external view override returns (uint256) {
        return mivp;
    }

    function setCommissionRateInterval() external view override returns (uint256) {
        return scri;
    }

    function feePoolInterval() external view override returns (uint256) {
        return fpi;
    }

    function recordsAmountPeriod() external view override returns (uint256) {
        return rap;
    }

    function forfeit() external view override returns (uint256) {
        return fft;
    }

    function jailThreshold() external view override returns (uint256) {
        return jtd;
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
