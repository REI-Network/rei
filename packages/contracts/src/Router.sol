// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IFee.sol";
import "./interfaces/IFreeFee.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IStakeManager.sol";
import "./Only.sol";

contract Router is ReentrancyGuard, Only {
    using SafeMath for uint256;

    constructor(IConfig config) public Only(config) {}

    modifier onlySystemCaller() {
        require(msg.sender == config.systemCaller(), "Router: only system caller");
        _;
    }

    function assignTransactionReward(
        address validator,
        address user,
        uint256 feeUsage,
        uint256 freeFeeUsage
    ) external payable nonReentrant onlySystemCaller {
        if (feeUsage > 0) {
            IFee(config.fee()).consume(user, feeUsage);
        }
        if (freeFeeUsage > 0) {
            IFreeFee(config.freeFee()).consume(user, freeFeeUsage);
        }
        if (msg.value > 0) {
            IFeePool(config.feePool()).accumulate{ value: msg.value }(true);
        }
        IFeePool(config.feePool()).earn(validator, feeUsage.add(freeFeeUsage).add(msg.value));
    }

    function assignBlockReward(address validator) external payable nonReentrant onlySystemCaller {
        require(msg.value > 0, "Router: invalid msg.value");
        uint8 factor = config.minerRewardFactor();
        require(factor <= 100, "Router: invalid factor");
        uint256 minerReward = msg.value.mul(factor).div(100);
        if (minerReward > 0) {
            IStakeManager(config.stakeManager()).reward{ value: minerReward }(validator);
        }
        uint256 feePoolReward = msg.value - minerReward;
        if (feePoolReward > 0) {
            IFeePool(config.feePool()).accumulate{ value: feePoolReward }(false);
        }
    }

    function onAfterBlock(address[] calldata acValidators, int256[] calldata priorities) external nonReentrant onlySystemCaller {
        IStakeManager(config.stakeManager()).onAfterBlock(acValidators, priorities);
        IFreeFee(config.freeFee()).onAfterBlock();
        IFeePool(config.feePool()).onAfterBlock();
    }
}
