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

    // global timestamp, update every 24 hours
    uint256 public override globalTimestamp;

    // addresses of all validators who have produced blocks,
    // it will be cleared when global timestamp is updated
    address[] public override validators;

    constructor(IConfig config) public Only(config) {}

    /**
     * Get validators length.
     */
    function validatorsLength() external view override returns (uint256) {
        return validators.length;
    }

    /**
     * 1. Increase miner's share and total shares
     * 2. If 1 day is reached, distribute rewards to all validators
     * @param _validator        Miner address
     * @param amount            Miner reward amount
     */
    function distribute(address _validator, uint256 amount) external payable override nonReentrant onlySystemCaller {
        // 1. Increase miner's share and total shares
        uint256 shares = sharesOf[_validator];
        if (shares == 0) {
            validators.push(_validator);
        }
        sharesOf[_validator] = shares.add(amount);
        totalShares = totalShares.add(amount);

        // 2. If 1 day is reached, distribute rewards to all validators
        if (globalTimestamp + 86400 < block.timestamp) {
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
            globalTimestamp = block.timestamp;
        }
    }
}
