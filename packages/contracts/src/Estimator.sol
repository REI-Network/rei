// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IEstimator.sol";
import "./interfaces/IConfig.sol";
import "./interfaces/IStakeManager.sol";
import "./interfaces/ICommissionShare.sol";

contract Estimator is IEstimator {
    IConfig public config;
    IStakeManager public stakeManager;

    constructor(address _config, address _stakeManager) public {
        config = IConfig(_config);
        stakeManager = IStakeManager(_stakeManager);
    }

    /**
     * @dev Estimate the mininual stake amount for validator.
     *      If the stake amount is less than this value, transaction will fail.
     * @param validator    Validator address
     */
    function estimateMinStakeAmount(address validator) external view override returns (uint256 amount) {
        address commissionShare = stakeManager.validators(validator).commissionShare;
        if (commissionShare == address(0)) {
            amount = 1;
        } else {
            amount = ICommissionShare(commissionShare).estimateStakeAmount(1);
            if (amount == 0) {
                amount = 1;
            }
        }
    }

    /**
     * @dev Estimate how much GXC should be stake, if user wants to get the number of shares.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateStakeAmount(address validator, uint256 shares) external view override returns (uint256 amount) {
        address commissionShare = stakeManager.validators(validator).commissionShare;
        if (commissionShare == address(0)) {
            amount = shares;
        } else {
            amount = ICommissionShare(commissionShare).estimateStakeAmount(shares);
        }
    }

    /**
     * @dev Estimate the mininual unstake shares for validator.
     *      If the unstake shares is less than this value, transaction will fail.
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     */
    function estimateMinUnstakeShares(address validator) external view override returns (uint256 shares) {
        address commissionShare = stakeManager.validators(validator).commissionShare;
        if (commissionShare == address(0)) {
            shares = 0;
        } else {
            shares = ICommissionShare(commissionShare).estimateUnstakeShares(1);
        }
    }

    /**
     * @dev Estimate how much shares should be unstake, if user wants to get the amount of GXC.
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param amount       Number of GXC
     */
    function estimateUnstakeShares(address validator, uint256 amount) external view override returns (uint256 shares) {
        address commissionShare = stakeManager.validators(validator).commissionShare;
        if (commissionShare == address(0)) {
            shares = 0;
        } else {
            shares = ICommissionShare(commissionShare).estimateUnstakeShares(amount);
        }
    }

    /**
     * @dev Estimate how much GXC can be claim, if unstake the number of shares(when unstake timeout).
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateUnstakeAmount(address validator, uint256 shares) external view override returns (uint256 amount) {
        // address unstakeKeeper = stakeManager.validators(validator).unstakeKeeper;
        // if (unstakeKeeper == address(0)) {
        //     amount = 0;
        // } else {
        //     amount = IUnstakeKeeper(unstakeKeeper).estimateUnstakeAmount(shares);
        // }
    }
}
