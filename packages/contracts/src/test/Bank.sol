// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";

contract Bank {
    using SafeMath for uint256;

    mapping(address => uint256) public balanceOf;

    function deposit(address to) external payable {
        balanceOf[to] = balanceOf[to].add(msg.value);
    }

    function withdraw(uint256 amount, address payable to) external {
        balanceOf[msg.sender] = balanceOf[msg.sender].sub(amount, "Bank: insufficient balance");
        to.transfer(amount);
    }
}
