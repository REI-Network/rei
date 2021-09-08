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

    /**
     * @dev `UsageInfo` event contains the usage information of tx,
     *      It will be automatically appended to the end of the transaction log.
     * @param feeUsage          `dailyFee` usage
     * @param freeFeeUsage      `dailyFreeFee` usage
     * @param balanceUsage      Transaction sender's balance usage
     */
    event UsageInfo(uint256 feeUsage, uint256 freeFeeUsage, uint256 balanceUsage);

    constructor(IConfig config) public Only(config) {}

    modifier onlySystemCaller() {
        require(msg.sender == config.systemCaller(), "Router: only system caller");
        _;
    }

    /**
     * @dev Estimate daily fee and free fee left.
     * @param user              User address
     * @param timestamp         Timestamp
     */
    function estimateTotalFee(address user, uint256 timestamp) external view returns (uint256) {
        return IFee(config.fee()).estimateFee(user, timestamp).add(IFreeFee(config.freeFee()).estimateFreeFee(user, timestamp));
    }

    /**
     * @dev Assign transaction reward to miner, and emit the `UsageInfo` event,
     *      if the consumed fee is `dailyFee` or `dailyFreeFee`,
     *      it will only increase miner's share of the fee pool,
     *      otherwise, if the consumed fee is user's balance,
     *      it will add the fee to the fee pool and increase miner's share of the fee pool.
     * @param validator         Block miner
     * @param user              Transaction sender
     * @param feeUsage          `dailyFee` usage
     * @param freeFeeUsage      `dailyFreeFee` usage
     */
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
        emit UsageInfo(feeUsage, freeFeeUsage, msg.value);
    }

    /**
     * @dev Assign block reward, and call `onAssignBlockReward` callback,
     *      it will split the block reward into two parts according to the `minerRewardFactor`,
     *      one part will be directly distributed to miners as a reward,
     *      and the other part will be added to the transaction fee pool.
     * @param validator         Block miner
     */
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

        IFeePool(config.feePool()).onAssignBlockReward();
    }

    /**
     * @dev After block callback, it only can be called by system caller
     * @param acValidators      Parameter of StakeManager.onAfterBlock
     * @param priorities        Parameter of StakeManager.onAfterBlock
     */
    function onAfterBlock(address[] calldata acValidators, int256[] calldata priorities) external nonReentrant onlySystemCaller {
        IStakeManager(config.stakeManager()).onAfterBlock(acValidators, priorities);
        IFreeFee(config.freeFee()).onAfterBlock();
    }
}
