// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IFee.sol";
import "./Only.sol";

contract Fee is ReentrancyGuard, Only, IFee {
    using SafeMath for uint256;

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

    /**
     * This is a special event log,
     * each transaction will be followed by such a log to indicate the specific consumption of the transaction
     */
    event Usage(uint256 indexed feeUsage, uint256 indexed balanceUsage);

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
        totalAmount = totalAmount.add(msg.value);
        emit Deposit(msg.sender, user, msg.value);
    }

    /**
     * Withdraw amount from target user.
     * @param user              Target user address
     * @param amount            Withdraw amount
     */
    function withdraw(address user, uint256 amount) external override nonReentrant {
        DepositInfo storage di = userDeposit[user][msg.sender];
        // adding two timestamps will never overflow
        require(di.timestamp + config.withdrawDelay() < block.timestamp, "Fee: invalid withdraw delay");
        di.amount = di.amount.sub(amount);
        totalAmount = totalAmount.sub(amount);
        msg.sender.transfer(amount);
        emit Withdraw(msg.sender, user, amount);
    }
}
