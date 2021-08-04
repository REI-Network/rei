// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.6.2;

interface IStakeManager {
    
    function validatorsLength() external view returns (uint256);
    
    function getVotingPowerByIndex(uint256 index) external view returns (uint256);

    function estimateMinStakeAmount(address validator) external view returns (uint256);

    function estimateStakeAmount(address validator, uint256 shares) external view returns (uint256);

    function estimateMinUnstakeShares(address validator) external view returns (uint256);

    function estimateUnstakeShares(address validator, uint256 amount) external view returns (uint256);

    function estimateUnStakeAmount(address validator, uint256 shares) external view returns (uint256);
    
    function stake(address validator, address to) external payable returns (uint256);
    
    function startUnstake(address validator, address payable to, uint256 shares) external returns (uint256);
    
    function doUnstake() external;
}