// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IFee.sol";
import "./Only.sol";

contract Fee is ReentrancyGuard, Only, IFee {
    using SafeMath for uint256;

    // user total amount
    mapping(address => uint256) public override userTotalAmount;
    // user usage information
    mapping(address => UsageInfo) public override userUsage;
    // user deposit information
    mapping(address => mapping(address => DepositInfo)) public override userDeposit;

    // total deposit amount
    uint256 public override totalAmount;

    /**
     * Emit when user deposits.
     * @param by        Deposit user
     * @param to        Receiver user
     * @param amount    Deposit amount
     */
    event Deposit(address indexed by, address indexed to, uint256 indexed amount);

    /**
     * Emit when user withdraws.
     * @param by        Withdraw user
     * @param from      From user
     * @param amount    Withdraw amount
     */
    event Withdraw(address indexed by, address indexed from, uint256 indexed amount);

    constructor(IConfig config) public Only(config) {}

    /**
     * Deposit amount to target user.
     * @param user      Target user address
     */
    function deposit(address user) external payable override nonReentrant {
        require(msg.value > 0, "Fee: invalid value");
        require(uint160(user) > 2000, "Fee: invalid user");
        DepositInfo storage di = userDeposit[user][msg.sender];
        di.amount = di.amount.add(msg.value);
        di.timestamp = block.timestamp;
        userTotalAmount[user] = userTotalAmount[user].add(msg.value);
        totalAmount = totalAmount.add(msg.value);
        emit Deposit(msg.sender, user, msg.value);
    }

    /**
     * Withdraw amount from target user.
     * @param user              Target user address
     * @param desiredAmount     Desired withdraw amount
     * @param minAmount         Min withdraw amount
     */
    function withdraw(
        address user,
        uint256 desiredAmount,
        uint256 minAmount
    ) external override nonReentrant {
        require(minAmount > 0 && desiredAmount >= minAmount, "Fee: invalid desired amount or min amount");
        uint256 withdrawableAmount = estimateWithdrawableAmount(user, block.timestamp);
        if (desiredAmount < withdrawableAmount) {
            withdrawableAmount = desiredAmount;
        } else {
            require(withdrawableAmount >= minAmount, "Fee: withdrawable amount is too small");
        }

        DepositInfo storage di = userDeposit[user][msg.sender];
        // adding two timestamps will never overflow
        require(di.timestamp + config.withdrawDelay() < block.timestamp, "Fee: invalid withdraw delay");
        di.amount = di.amount.sub(withdrawableAmount);
        userTotalAmount[user] = userTotalAmount[user].sub(withdrawableAmount);
        totalAmount = totalAmount.sub(withdrawableAmount);
        msg.sender.transfer(withdrawableAmount);
        emit Withdraw(msg.sender, user, withdrawableAmount);
    }

    /**
     * Estimate wtihdrawable timestamp, if the estimation fails, return 0.
     * @param user      Target user address
     * @param from      From user address
     */
    function estimateWithdrawableTimestamp(address user, address from) external view override returns (uint256 timestamp) {
        DepositInfo memory di = userDeposit[user][from];
        if (di.timestamp == 0) {
            return 0;
        }
        timestamp = di.timestamp + config.withdrawDelay();

        if (totalAmount == 0) {
            return 0;
        }
        UsageInfo memory ui = userUsage[user];
        uint256 usage = estimateUsage(ui, block.timestamp);
        uint256 fee = userTotalAmount[user].mul(config.dailyFee()) / totalAmount;
        // if the usage is greater than the fee, it means that the user has debts that need to be repaid
        if (usage > fee) {
            uint256 recoverInterval = config.feeRecoverInterval();
            /**
             * userUsage = (1 - (block.timestamp - ui.timestamp) / recoverInterval) * ui.usage
             * userUsage' = (1 - (repayTimestamp - ui.timestamp) / recoverInterval) * ui.usage
             * debt = usage - fee = userUsage - userUsage'
             * repayTimestamp = debt * recoverInterval / ui.usage + block.timestamp
             */
            uint256 repayTimestamp = ((usage - fee).mul(recoverInterval) / ui.usage).add(block.timestamp); // if usage is greater than fee, ui.usage will never be zero
            uint256 maxRepayTimestamp = block.timestamp.add(recoverInterval);
            if (repayTimestamp > maxRepayTimestamp) {
                // this shouldn't happen, we just make sure this
                repayTimestamp = maxRepayTimestamp;
            }
            // if the time required to repay the debt is greater than withdrawDelay, then we use repayTimestamp
            if (repayTimestamp > timestamp) {
                timestamp = repayTimestamp;
            }
        }
    }

    /**
     * Estimate wtihdrawable amount.
     * @param user      Target user address
     * @param timestamp Current timestamp
     */
    function estimateWithdrawableAmount(address user, uint256 timestamp) public view override returns (uint256) {
        uint256 fee = estimateFee(user, timestamp);
        uint256 dailyFee = config.dailyFee();
        if (fee == 0 || dailyFee == 0) {
            return 0;
        }
        return fee.mul(totalAmount) / dailyFee;
    }

    /**
     * Estimate user fee.
     *
     *      userFee = userTotalAmount * dailyFee / totalAmount - userUsage
     *
     * @param user      User address
     * @param timestamp Current timestamp
     */
    function estimateFee(address user, uint256 timestamp) public view override returns (uint256 fee) {
        if (totalAmount == 0) {
            return 0;
        }
        fee = userTotalAmount[user].mul(config.dailyFee()) / totalAmount;
        uint256 usage = estimateUsage(userUsage[user], timestamp);
        fee = fee > usage ? fee - usage : 0;
    }

    /**
     * Estimate user usage
     *
     *      T: current timestamp
     *      T': last timestamp
     *      userUsage': last fee usage
     *
     *      if T - T' < feeRecoverInterval
     *          userUsage = (1 - (T - T') / feeRecoverInterval) * userUsage'
     *      else
     *          userUsage = 0
     *
     * @param ui        Usage information
     * @param timestamp Current timestamp
     */
    function estimateUsage(UsageInfo memory ui, uint256 timestamp) public view override returns (uint256 usage) {
        uint256 interval = timestamp > ui.timestamp ? timestamp - ui.timestamp : 0;
        if (interval == 0) {
            return ui.usage;
        }
        uint256 recoverInterval = config.feeRecoverInterval();
        if (ui.usage > 0 && interval < recoverInterval) {
            usage = recoverInterval.sub(interval).mul(ui.usage) / recoverInterval;
        }
    }

    /**
     * Consume user fee, can only be called by the system caller.
     * @param user      User address
     * @param usage     Number of usage fee
     */
    function consume(address user, uint256 usage) external override nonReentrant onlyRouter {
        require(usage > 0, "Fee: invalid usage");
        UsageInfo storage ui = userUsage[user];
        ui.usage = estimateUsage(ui, block.timestamp).add(usage);
        // update timestamp, because we want to record the latest timestamp in the last 24 hours
        ui.timestamp = block.timestamp;
    }
}
