// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.6.2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IConfig.sol";
import "./Share.sol";

struct Unstake {
    address validator;
    address payable to;
    uint256 unstakeShares;
    uint256 timestamp;
}

contract StakeManager is ReentrancyGuard {
    using SafeMath for uint256;
    
    IConfig public config;
    
    mapping(address => address) public validatorToShare;
    mapping(address => address) public validatorToUnstakeShare;
    address[] public validators;
    
    uint256 public firstId = 0;
    uint256 public lastId = 0;
    mapping(uint256 => Unstake) public unstakeQueue;
    
    event Stake(address indexed validator, address to, uint256 value, uint256 shares);
    event StartUnstake(uint256 indexed id, address indexed validator, address to, uint256 shares, uint256 timestamp);
    event DoUnstake(uint256 indexed id, address indexed validator, address to, uint256 amount);
    
    constructor(address _config) public {
        config = IConfig(_config);
    }
    
    function validatorsLength() external view returns (uint256) {
        return validators.length;
    }
    
    function getVotingPowerByIndex(uint256 index) external view returns (uint256) {
        require(index < validators.length, "StakeManager: invalid validator index");
        address share = validatorToShare[validators[index]];
        require(share != address(0), "StakeManager: invalid validator");
        return share.balance.div(config.amountPerVotingPower());
    }

    function estimateMinStakeAmount(address validator) external view returns (uint256 amount) {
        address share = validatorToShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
        amount = Share(share).estimateStakeAmount(1);
        if (amount < config.minStakeAmount()) {
            amount = config.minStakeAmount();
        }
    }

    function estimateStakeAmount(address validator, uint256 shares) external view returns (uint256) {
        address share = validatorToShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
        return Share(share).estimateStakeAmount(shares);
    }

    function estimateMinUnstakeShares(address validator) external view returns (uint256) {
        address share = validatorToShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
        return Share(share).estimateUnstakeShares(config.minUnstakeAmount());
    }
    
    function estimateUnstakeShares(address validator, uint256 amount) external view returns (uint256) {
        address share = validatorToShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
        return Share(share).estimateUnstakeShares(amount);
    }
    
    receive() external payable {}
    
    function stake(address validator, address to) external payable nonReentrant returns (uint256 shares) {
        require(uint160(validator) > 20000, "StakeManager: invalid validator");
        require(uint160(to) > 20000, "StakeManager: invalid receiver");
        require(msg.value >= config.minStakeAmount(), "StakeManager: invalid stake amount");
        address share = validatorToShare[validator];
        if (share == address(0)) {
            share = address(new Share(address(config), validator, true));
            validatorToShare[validator] = share;
            validatorToUnstakeShare[validator] = address(new Share(address(config), validator, false));
            validators.push(validator);
        }
        shares = Share(share).mint{ value: msg.value }(to);
        emit Stake(validator, to, msg.value, shares);
    }
    
    function startUnstake(address validator, address payable to, uint256 shares) external nonReentrant returns (uint256 id) {
        require(uint160(to) > 20000, "StakeManager: invalid receiver");
        require(shares > 0, "StakeManager: invalid shares");
        address share = validatorToShare[validator];
        address unstakeShare = validatorToUnstakeShare[validator];
        require(share != address(0) && unstakeShare != address(0), "StakeManager: invalid validator");
        
        Share(share).transferFrom(msg.sender, address(this), shares);
        uint256 amount = Share(share).burn(shares, address(this));
        require(amount >= config.minUnstakeAmount(), "StakeManager: invalid unstake amount");
        uint256 unstakeShares = Share(unstakeShare).mint{ value: amount }(address(this));
        
        id = lastId;
        lastId = id.add(1);
        uint256 timestamp = block.timestamp + config.unstakeDelay();
        Unstake memory u = unstakeQueue[lastId];
        if (u.validator != address(0) && u.timestamp > timestamp) {
            timestamp = u.timestamp;
        }
        unstakeQueue[id] = Unstake(validator, to, unstakeShares, timestamp);
        emit StartUnstake(id, validator, to, shares, timestamp);
    }
    
    function doUnstake() external nonReentrant {
        uint256 _lastId = lastId;
        uint256 _firstId = firstId;
        for (; _firstId < _lastId; _firstId = _firstId.add(1)) {
            Unstake memory u = unstakeQueue[_firstId];
            if (u.timestamp <= block.timestamp && gasleft() >= 50000) {
                address unstakeShare = validatorToUnstakeShare[u.validator];
                require(unstakeShare != address(0), "StakeManager: invalid validator");
                emit DoUnstake(_firstId, u.validator, u.to, Share(unstakeShare).burn(u.unstakeShares, u.to));
                delete unstakeQueue[_firstId];
            } else {
                break;
            }
        }
        firstId = _firstId;
    }
    
    function slash(address validator, uint8 reason) external nonReentrant returns (uint256 amount) {
        require(uint160(validator) > 20000, "StakeManager: invalid validator");
        address share = validatorToShare[validator];
        address unstakeShare = validatorToUnstakeShare[validator];
        require(share != address(0) && unstakeShare != address(0), "StakeManager: invalid validator");
        uint8 factor = config.getFactorByReason(reason);
        amount = Share(share).slash(factor).add(Share(unstakeShare).slash(factor));
    }
}