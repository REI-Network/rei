// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IStakeManager.sol";
import "./Only.sol";

contract FeePool is ReentrancyGuard, Only, IFeePool {
    using SafeMath for uint256;

    mapping(address => uint256) public override sharesOf;

    uint256 public override totalShares;
    uint256 public override accTxFee;
    uint256 public override globalTimestamp;

    address[] public override validators;

    constructor(IConfig config) public Only(config) {}

    function validatorsLength() external view override returns (uint256) {
        return validators.length;
    }

    function earn(address validator, uint256 earned) external override nonReentrant onlyRouter {
        uint256 shares = sharesOf[validator];
        if (shares == 0) {
            validators.push(validator);
        }
        sharesOf[validator] = shares.add(earned);
        totalShares = totalShares.add(earned);
    }

    function accumulate(bool isTxFee) external payable override nonReentrant onlyRouter {
        if (isTxFee) {
            accTxFee = accTxFee.add(msg.value);
        }
    }

    function onAfterBlock() external override nonReentrant onlyRouter {
        if (globalTimestamp.add(config.feePoolLiquidateInterval()) < block.timestamp) {
            uint256 balance = address(this).balance;
            uint256 _totalShares = totalShares;
            if (validators.length != 0 && _totalShares != 0 && balance != 0) {
                IStakeManager sm = IStakeManager(config.stakeManager());
                for (uint256 i = validators.length.sub(1); ; i--) {
                    address validator = validators[i];
                    uint256 reward = i == 0 ? address(this).balance : sharesOf[validator].mul(balance) / _totalShares;
                    if (reward > 0) {
                        sm.reward{ value: reward }(validator);
                    }
                    delete sharesOf[validator];
                    validators.pop();

                    if (i == 0) {
                        break;
                    }
                }
            }
            totalShares = 0;
            accTxFee = 0;
            globalTimestamp = block.timestamp;
        }
    }
}
