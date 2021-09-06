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
     * @dev Emit when user deposits.
     * @param by        Deposit user
     * @param to        Receiver user
     * @param amount    Deposit amount
     */
    event Deposit(address indexed by, address indexed to, uint256 indexed amount);

    /**
     * @dev Emit when user withdraws.
     * @param by        Withdraw user
     * @param from      From user
     * @param amount    Withdraw amount
     */
    event Withdraw(address indexed by, address indexed from, uint256 indexed amount);

    constructor(IConfig config) public Only(config) {}

    /**
     * @dev Deposit amount to target user.
     * @param user      Target user address
     */
    function deposit(address user) external payable override nonReentrant {
        require(msg.value > 0, "FeeManager: invalid value");
        DepositInfo storage di = userDeposit[user][msg.sender];
        di.amount = di.amount.add(msg.value);
        di.timestamp = block.timestamp;
        userTotalAmount[user] = userTotalAmount[user].add(msg.value);
        totalAmount = totalAmount.add(msg.value);
        emit Deposit(msg.sender, user, msg.value);
    }

    /**
     * @dev Withdraw amount from target user.
     * @param amount    Withdraw amount
     * @param user      Target user address
     */
    function withdraw(uint256 amount, address user) external override nonReentrant {
        require(amount > 0, "FeeManager: invalid amount");
        require(whetherPayOffDebt(user, block.timestamp), "FeeManager: user debt");
        DepositInfo storage di = userDeposit[user][msg.sender];
        // adding two timestamps will never overflow
        require(di.timestamp + config.withdrawDelay() < block.timestamp, "FeeManager: invalid withdraw delay");
        di.amount = di.amount.sub(amount);
        userTotalAmount[user] = userTotalAmount[user].sub(amount);
        totalAmount = totalAmount.sub(amount);
        msg.sender.transfer(amount);
        emit Withdraw(msg.sender, user, amount);
    }

    /**
     * @dev Estimate whether the debt has been paid off
     * @param user      Target user address
     * @param timestamp Current timestamp
     */
    function whetherPayOffDebt(address user, uint256 timestamp) public view override returns (bool) {
        uint256 fee = userTotalAmount[user].mul(config.dailyFee()).div(totalAmount);
        uint256 usage = estimateUsage(userUsage[user], timestamp);
        return fee >= usage;
    }

    /**
     * @dev Estimate user fee.
     *      userFee = userTotalAmount * dailyFee / totalAmount - userUsage
     * @param user      User address
     * @param timestamp Current timestamp
     */
    function estimateFee(address user, uint256 timestamp) external view override returns (uint256 fee) {
        fee = userTotalAmount[user].mul(config.dailyFee()).div(totalAmount);
        uint256 usage = estimateUsage(userUsage[user], timestamp);
        fee = fee > usage ? fee - usage : 0;
    }

    /**
     * @dev Estimate user usage
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
            usage = recoverInterval.sub(interval).mul(ui.usage).div(recoverInterval);
        }
    }

    // TODO: add a event for receipt
    /**
     * @dev Consume user fee, can only be called by the system caller.
     * @param user      User address
     * @param usage     Number of usage fee
     */
    function consume(address user, uint256 usage) external override nonReentrant onlyRouter {
        require(usage > 0, "FeeManager: invalid usage");
        UsageInfo storage ui = userUsage[user];
        ui.usage = estimateUsage(ui, block.timestamp).add(usage);
        // update timestamp, because we want to record the latest timestamp in the last 24 hours
        ui.timestamp = block.timestamp;
    }
}
