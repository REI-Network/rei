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
    address internal ff = 0x0000000000000000000000000000000000001006;
    address internal fp = 0x0000000000000000000000000000000000001007;
    address internal r = 0x0000000000000000000000000000000000001008;
    address internal cf = 0x000000000000000000000000000000000000100b;

    uint256 internal ud = 1 seconds;
    uint256 internal wd = 1 seconds;
    uint256 internal df = 12e16; // 0.012 REI
    uint256 internal dff = 12e15; // 0.0012 REI
    uint256 internal uffl = 6e15; // 0.0006 REI
    uint256 internal fri = 10 seconds;
    uint256 internal ffri = 10 seconds;
    uint256 internal fpli = 10 seconds;
    uint256 internal mivp = 10000;
    uint256 internal scri = 5 seconds;
    uint8 internal mrf = 90;

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

    function setFreeFee(address _ff) external onlyOwner {
        ff = _ff;
    }

    function setFeePool(address _fp) external onlyOwner {
        fp = _fp;
    }

    function setRouter(address _r) external onlyOwner {
        r = _r;
    }

    function setContractFee(address _cf) external onlyOwner {
        cf = _cf;
    }

    function setUnstakeDelay(uint256 _ud) external onlyOwner {
        ud = _ud;
    }

    function setWithdrawDelay(uint256 _wd) external onlyOwner {
        wd = _wd;
    }

    function setDailyFee(uint256 _df) external onlyOwner {
        df = _df;
    }

    function setDailyFreeFee(uint256 _dff) external onlyOwner {
        dff = _dff;
    }

    function setUserFreeFeeLimit(uint256 _uffl) external onlyOwner {
        uffl = _uffl;
    }

    function setFeeRecoverInterval(uint256 _fri) external onlyOwner {
        fri = _fri;
    }

    function setFreeFeeRecoverInterval(uint256 _ffri) external onlyOwner {
        ffri = _ffri;
    }

    function setFeePoolLiquidateInterval(uint256 _fpli) external onlyOwner {
        fpli = _fpli;
    }

    function setMinIndexVotingPower(uint256 _mivp) external onlyOwner {
        mivp = _mivp;
    }

    function setSetCommissionRateInterval(uint256 _scri) external onlyOwner {
        scri = _scri;
    }

    function setMinerRewardFactor(uint8 _mrf) external onlyOwner {
        mrf = _mrf;
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

    function freeFee() external view override returns (address) {
        return ff;
    }

    function feePool() external view override returns (address) {
        return fp;
    }

    function router() external view override returns (address) {
        return r;
    }

    function contractFee() external view override returns (address) {
        return cf;
    }

    function unstakeDelay() external view override returns (uint256) {
        return ud;
    }

    function withdrawDelay() external view override returns (uint256) {
        return wd;
    }

    function dailyFee() external view override returns (uint256) {
        return df;
    }

    function dailyFreeFee() external view override returns (uint256) {
        return dff;
    }

    function userFreeFeeLimit() external view override returns (uint256) {
        return uffl;
    }

    function feeRecoverInterval() external view override returns (uint256) {
        return fri;
    }

    function freeFeeRecoverInterval() external view override returns (uint256) {
        return ffri;
    }

    function feePoolLiquidateInterval() external view override returns (uint256) {
        return fpli;
    }

    function minIndexVotingPower() external view override returns (uint256) {
        return mivp;
    }

    function setCommissionRateInterval() external view override returns (uint256) {
        return scri;
    }

    function minerRewardFactor() external view override returns (uint8) {
        return mrf;
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
