// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IFee.sol";
import "./interfaces/IFreeFee.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IContractFee.sol";
import "./interfaces/IStakeManager.sol";
import "./Only.sol";

contract Router is ReentrancyGuard, Only {
    using SafeMath for uint256;

    /**
     * @dev `UsageInfo` event contains the usage information of tx,
     *      It will be automatically appended to the end of the transaction log.
     * @param feeUsage          `dailyFee` usage
     * @param freeFeeUsage      `dailyFreeFee` usage
     * @param contractFeeUsage  Contract fee usage
     * @param balanceUsage      Transaction sender's balance usage
     */
    event UsageInfo(uint256 feeUsage, uint256 freeFeeUsage, uint256 contractFeeUsage, uint256 balanceUsage);

    constructor(IConfig config) public Only(config) {}

    modifier onlySystemCaller() {
        require(msg.sender == config.systemCaller(), "Router: only system caller");
        _;
    }

    /**
     * @dev Estimate daily fee and free fee left.
     * @param from              Transaction sender
     * @param to                Transaction receiver(if contract creation, address(0))
     * @param timestamp         Timestamp
     */
    function estimateTotalFee(
        address from,
        address to,
        uint256 timestamp
    )
        external
        view
        returns (
            uint256 fee,
            uint256 freeFee,
            uint256 contractFee
        )
    {
        IFee _fee = IFee(config.fee());
        fee = _fee.estimateFee(from, timestamp);
        freeFee = IFreeFee(config.freeFee()).estimateFreeFee(from, timestamp);
        // if the transaction is a contract creation, to address will be zero
        // if the transaction isn't a contract creation and tx.to is address(0), it still doesn't matter,
        // because address(0) will never be a contract address
        if (to != address(0)) {
            contractFee = IContractFee(config.contractFee()).feeOf(to);
            if (contractFee > 0) {
                uint256 availableContractFee = _fee.estimateFee(to, timestamp);
                if (contractFee > availableContractFee) {
                    contractFee = availableContractFee;
                }
            }
        }
    }

    /**
     * @dev Assign transaction reward to miner, and emit the `UsageInfo` event,
     *      if the consumed fee is `dailyFee` or `dailyFreeFee`,
     *      it will only increase miner's share of the fee pool,
     *      otherwise, if the consumed fee is user's balance,
     *      it will add the fee to the fee pool and increase miner's share of the fee pool.
     * @param validator         Block miner
     * @param from              Transaction sender
     * @param to                Transaction receiver(if contract creation, address(0))
     * @param feeUsage          `dailyFee` usage
     * @param freeFeeUsage      `dailyFreeFee` usage
     * @param contractFeeUsage  Contract fee usage
     */
    function assignTransactionReward(
        address validator,
        address from,
        address to,
        uint256 feeUsage,
        uint256 freeFeeUsage,
        uint256 contractFeeUsage
    ) external payable nonReentrant onlySystemCaller {
        IFee fee = IFee(config.fee());
        IFeePool feePool = IFeePool(config.feePool());
        if (feeUsage > 0) {
            fee.consume(from, feeUsage);
        }
        if (freeFeeUsage > 0) {
            IFreeFee(config.freeFee()).consume(from, freeFeeUsage);
        }
        if (msg.value > 0) {
            feePool.accumulate{ value: msg.value }(true);
        }
        if (contractFeeUsage > 0) {
            fee.consume(to, contractFeeUsage);
        }
        feePool.earn(validator, feeUsage.add(freeFeeUsage).add(contractFeeUsage).add(msg.value));
        emit UsageInfo(feeUsage, freeFeeUsage, contractFeeUsage, msg.value);
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

        // call onAssignBlockReward callback
        IFeePool(config.feePool()).onAssignBlockReward();
    }

    /**
     * @dev After block callback, it only can be called by system caller
     * @param _proposer         Proposer address
     * @param acValidators      Parameter of StakeManager.onAfterBlock
     * @param priorities        Parameter of StakeManager.onAfterBlock
     */
    function onAfterBlock(
        address _proposer,
        address[] calldata acValidators,
        int256[] calldata priorities
    ) external nonReentrant onlySystemCaller {
        IStakeManager(config.stakeManager()).onAfterBlock(_proposer, acValidators, priorities);
        IFreeFee(config.freeFee()).onAfterBlock();
    }
}
