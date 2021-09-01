// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IFeeManager.sol";
import "./libraries/Math.sol";
import "./Only.sol";

contract FeeManager is Only {
    using SafeMath for uint256;

    // user total amount
    mapping(address => uint256) public userTotalAmount;
    // user usage information
    mapping(address => UsageInfo) public userUsage;
    // user deposit information
    mapping(address => DepositInfo) public userDeposit;
    // delegated user deposit information
    mapping(address => mapping(address => DepositInfo)) public delegatedUserDeposit;

    // total deposit amount
    uint256 public totalAmount;

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
     * @dev Deposit to yourself.
     */
    function deposit() external payable {
        require(msg.value > 0, "FeeManager: invalid value");
        userTotalAmount[msg.sender] = userTotalAmount[msg.sender].add(msg.value);
        DepositInfo storage di = userDeposit[msg.sender];
        di.amount = di.amount.add(msg.value);
        di.timestamp = block.timestamp;
        totalAmount = totalAmount.add(msg.value);
        emit Deposit(msg.sender, msg.sender, msg.value);
    }

    /**
     * @dev Deposit to another user.
     * @param user      Target user address
     */
    function depositTo(address user) external payable {
        require(msg.value > 0, "FeeManager: invalid value");
        require(msg.sender != user, "FeeManager: invalid user");
        userTotalAmount[user] = userTotalAmount[user].add(msg.value);
        DepositInfo storage di = delegatedUserDeposit[user][msg.sender];
        di.amount = di.amount.add(msg.value);
        di.timestamp = block.timestamp;
        totalAmount = totalAmount.add(msg.value);
        emit Deposit(msg.sender, user, msg.value);
    }

    /**
     * @dev Withdraw amount from yourself.
     * @param amount    Withdraw amount
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "FeeManager: invalid amount");
        DepositInfo storage di = userDeposit[msg.sender];
        // adding two timestamps will never overflow
        require(di.timestamp + config.withdrawDelay() < block.timestamp, "FeeManager: invalid withdraw delay");
        di.amount = di.amount.sub(amount);
        userTotalAmount[msg.sender] = userTotalAmount[msg.sender].sub(amount);
        totalAmount = totalAmount.sub(amount);
        msg.sender.transfer(amount);
        emit Withdraw(msg.sender, msg.sender, amount);
    }

    /**
     * @dev Withdraw amount from another user.
     * @param amount    Withdraw amount
     * @param user      Target user address
     */
    function withdrawFrom(uint256 amount, address user) external {
        require(amount > 0, "FeeManager: invalid amount");
        require(msg.sender != user, "FeeManager: invalid user");
        DepositInfo storage di = delegatedUserDeposit[user][msg.sender];
        // adding two timestamps will never overflow
        require(di.timestamp + config.withdrawDelay() < block.timestamp, "FeeManager: invalid withdraw delay");
        di.amount = di.amount.sub(amount);
        userTotalAmount[user] = userTotalAmount[user].sub(amount);
        totalAmount = totalAmount.sub(amount);
        msg.sender.transfer(amount);
        emit Withdraw(msg.sender, user, amount);
    }

    /**
     * @dev Estimate user fee.
     *      userFee = userTotalAmount * dailyFee / totalAmount - userUsage
     * @param user      User address
     */
    function estimateFee(address user) external view returns (uint256 fee) {
        fee = userTotalAmount[user].mul(config.dailyFee()).div(totalAmount);
        uint256 usage = estimateUsage(userUsage[user]);
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
     */
    function estimateUsage(UsageInfo memory ui) public view returns (uint256 usage) {
        uint256 interval = block.timestamp.sub(ui.timestamp);
        if (ui.usage > 0 && interval < config.feeRecoverInterval()) {
            usage = ui.usage.sub(interval.mul(ui.usage).div(config.feeRecoverInterval()));
        }
    }

    /**
     * @dev Consume user fee, can only be called by the system caller.
     * @param user      User address
     * @param usage     Number of usage fee
     */
    function consume(address user, uint256 usage) external onlySystemCaller {
        require(usage > 0, "FeeManager: invalid usage");
        UsageInfo storage ui = userUsage[user];
        // adding two timestamps will never overflow
        if (ui.timestamp + config.feeRecoverInterval() < block.timestamp) {
            ui.usage = usage;
        } else {
            ui.usage = ui.usage.add(usage);
        }
        // always update timestamp,
        // because we want to record the latest timestamp in the last 24 hours
        ui.timestamp = block.timestamp;
    }
}
