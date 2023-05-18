// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IConfig.sol";

/**
 * Config contract for mainnet.
 * In rei-network, system contracts can be updated through hard forks,
 * and DAO logic will be added in the futhure.
 */
contract Config is Ownable, IConfig {
    constructor() public {
        // TODO:
        transferOwnership(0x513E20C58FfB430dbEBd685513e142D5468bA4D3);
    }

    address public override stakeManager = 0x0000000000000000000000000000000000001001;

    address public override systemCaller = 0x0000000000000000000000000000000000001002;

    address public override unstakePool = 0x0000000000000000000000000000000000001003;

    address public override validatorRewardPool = 0x0000000000000000000000000000000000001004;

    address public override fee = 0x0000000000000000000000000000000000001005;

    address public override feePool = 0x0000000000000000000000000000000000001006;

    address public override feeToken = 0x0000000000000000000000000000000000001007;

    address public override prison = 0x0000000000000000000000000000000000001008;

    uint256 public override unstakeDelay = 7 days;

    uint256 public override withdrawDelay = 3 days;

    uint256 public override minIndexVotingPower = 1e23;

    uint256 public override setCommissionRateInterval = 1 days;

    uint256 public override feePoolInterval = 1 days;

    uint256 public override recordsAmountPeriod = 21600;

    uint256 public override forfeit = 2e22;

    uint256 public override jailThreshold = 300;

    uint256 public override maxValidatorsCount = 21;

    uint256 public override minValidatorsCount = 21;

    uint256 public override minTotalLockedAmount = 1e26;

    uint256 public override minerReward = 951293759512937595;

    uint256 public override dailyFee = 1440e18;

    uint256 public override minerRewardFactor = 90;

    event ConfigChange();

    function setUnstakeDelay(uint256 _unstakeDelay) external override onlyOwner {
        unstakeDelay = _unstakeDelay;
        emit ConfigChange();
    }

    function setWithdrawDelay(uint256 _withdrawDelay) external override onlyOwner {
        withdrawDelay = _withdrawDelay;
        emit ConfigChange();
    }

    function setSetCommissionRateInterval(uint256 _setCommissionRateInterval) external override onlyOwner {
        setCommissionRateInterval = _setCommissionRateInterval;
        emit ConfigChange();
    }

    function setFeePoolInterval(uint256 _feePoolInterval) external override onlyOwner {
        feePoolInterval = _feePoolInterval;
        emit ConfigChange();
    }

    function setForfeit(uint256 _forfeit) external override onlyOwner {
        forfeit = _forfeit;
        emit ConfigChange();
    }

    function setJailThreshold(uint256 _jailThreshold) external override onlyOwner {
        jailThreshold = _jailThreshold;
        emit ConfigChange();
    }

    function setMaxValidatorsCount(uint256 _maxValidatorsCount) external override onlyOwner {
        maxValidatorsCount = _maxValidatorsCount;
        emit ConfigChange();
    }

    function setMinValidatorsCount(uint256 _minValidatorsCount) external override onlyOwner {
        minValidatorsCount = _minValidatorsCount;
        emit ConfigChange();
    }

    function setMinTotalLockedAmount(uint256 _minTotalLockedAmount) external override onlyOwner {
        minTotalLockedAmount = _minTotalLockedAmount;
        emit ConfigChange();
    }

    function setMinerReward(uint256 _minerReward) external override onlyOwner {
        minerReward = _minerReward;
        emit ConfigChange();
    }

    function setDailyFee(uint256 _dailyFee) external override onlyOwner {
        dailyFee = _dailyFee;
        emit ConfigChange();
    }

    function setMinerRewardFactor(uint256 _minerRewardFactor) external override onlyOwner {
        minerRewardFactor = _minerRewardFactor;
        emit ConfigChange();
    }

    function getFactorByReason(uint8 reason) external view override returns (uint8) {
        if (reason == 0) {
            return 20;
        } else {
            revert("Config: invalid reason");
        }
    }
}
