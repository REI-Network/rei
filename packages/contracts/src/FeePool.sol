// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IStakeManager.sol";
import "./Only.sol";

contract FeePool is ReentrancyGuard, Only, IFeePool {
    using SafeMath for uint256;

    // miner share,
    // it will be cleared when global timestamp is updated
    mapping(address => uint256) public override sharesOf;

    // total share
    uint256 public override totalShares;
    // accumulative transaction fee,
    // it will increase when a user pays transaction fee through his balance
    uint256 public override accTxFee;
    // global timestamp, update every 24 hours
    uint256 public override globalTimestamp;

    // addresses of all validators who have produced blocks,
    // it will be cleared when global timestamp is updated
    address[] public override validators;

    constructor(IConfig config) public Only(config) {}

    /**
     * @dev Get validators length.
     */
    function validatorsLength() external view override returns (uint256) {
        return validators.length;
    }

    /**
     * @dev Increase miner's share.
     * @param validator         Miner address
     * @param earned            Miner earned share.
     */
    function earn(address validator, uint256 earned) external override nonReentrant onlyRouter {
        uint256 shares = sharesOf[validator];
        if (shares == 0) {
            validators.push(validator);
        }
        sharesOf[validator] = shares.add(earned);
        totalShares = totalShares.add(earned);
    }

    /**
     * @dev Add reward to fee pool.
     * @param isTxFee           Is transaction fee
     */
    function accumulate(bool isTxFee) external payable override nonReentrant onlyRouter {
        if (isTxFee) {
            accTxFee = accTxFee.add(msg.value);
        }
    }

    /**
     * @dev Assign block reward callback, it only can be called by router.
     */
    function onAssignBlockReward() external override nonReentrant onlyRouter {
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
                    // clear storage
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
