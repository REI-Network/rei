// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IConfig.sol";
import "./interfaces/IStakeManager.sol";
import "./Share.sol";

contract StakeManager is ReentrancyGuard, IStakeManager {
    using SafeMath for uint256;
    
    // config
    IConfig public config;
    
    mapping(address => address) public validatorToShare;
    mapping(address => address) public validatorToUnstakeShare;
    // all validators, will not be deleted forever
    address[] public validators;
    
    // first unstake id
    uint256 public firstId = 0;
    // last unstake id
    uint256 public lastId = 0;
    // unstake information, delete after `do unstake`
    mapping(uint256 => Unstake) public unstakeQueue;
    
    event Stake(address indexed validator, address to, uint256 value, uint256 shares);
    event StartUnstake(uint256 indexed id, address indexed validator, address to, uint256 shares, uint256 timestamp);
    event DoUnstake(uint256 indexed id, address indexed validator, address to, uint256 amount);
    
    constructor(address _config) public {
        config = IConfig(_config);
    }
    
    /**
     * @dev Get the validators length.
     */
    function validatorsLength() external view override returns (uint256) {
        return validators.length;
    }
    
    /**
     * @dev Get the voting power by validator index.
     *      Index shouldn't be out of range.
     *      Validator must exist.
     * @param index    The validator index
     */
    function getVotingPowerByIndex(uint256 index) external view override returns (uint256) {
        require(index < validators.length, "StakeManager: invalid validator index");
        address share = validatorToShare[validators[index]];
        require(share != address(0), "StakeManager: invalid validator");
        return share.balance.div(config.amountPerVotingPower());
    }

    /**
     * @dev Get the stake or unstake share contract address of the validator.
     * @param validator    Validator address
     * @param isStake      Return stake share contract address if `true`, unstake share contract address if `false`
     */
    function getShareContractAddress(address validator, bool isStake) external view override returns (address share) {
        share = isStake ? validatorToShare[validator] : validatorToUnstakeShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
    }

    /**
     * @dev Get the queued unstake information by unstake id.
     * @param id   Unstake id
     */
    function getQueuedUnstakeById(uint256 id) external view override returns (Unstake memory u) {
        u = unstakeQueue[id];
        require(u.validator != address(0), "StakeManager: invalid id");
    }

    /**
     * @dev Get the first unstake id.
     */
    function getFirstId() external view override returns (uint256) {
        return firstId;
    }

    /**
     * @dev Get the last unstake id.
     */
    function getLastId() external view override returns (uint256) {
        return lastId;
    }

    /**
     * @dev Estimate the mininual stake amount for validator.
     *      If the stake amount is less than this value, transaction will fail.
     * @param validator    Validator address
     */
    function estimateMinStakeAmount(address validator) external view override returns (uint256 amount) {
        address share = validatorToShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
        amount = Share(share).estimateStakeAmount(1);
        if (amount < config.minStakeAmount()) {
            amount = config.minStakeAmount();
        }
    }

    /**
     * @dev Estimate how much GXC should be stake, if user wants to get the number of shares.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateStakeAmount(address validator, uint256 shares) external view override returns (uint256) {
        address share = validatorToShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
        return Share(share).estimateStakeAmount(shares);
    }

    /**
     * @dev Estimate the mininual unstake shares for validator.
     *      If the unstake shares is less than this value, transaction will fail.
     * @param validator    Validator address
     */
    function estimateMinUnstakeShares(address validator) external view override returns (uint256) {
        address share = validatorToShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
        return Share(share).estimateUnstakeShares(config.minUnstakeAmount());
    }
    
    /**
     * @dev Estimate how much shares should be unstake, if user wants to get the amount of GXC.
     * @param validator    Validator address
     * @param amount       Number of GXC
     */
    function estimateUnstakeShares(address validator, uint256 amount) external view override returns (uint256) {
        address share = validatorToShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
        return Share(share).estimateUnstakeShares(amount);
    }

    /**
     * @dev Estimate how much GXC can be claim, if unstake the number of shares(when unstake timeout).
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateUnStakeAmount(address validator, uint256 shares) external view override returns (uint256) {
        address share = validatorToUnstakeShare[validator];
        require(share != address(0), "StakeManager: invalid validator");
        return Share(share).estimateUnStakeAmount(shares);
    }

    // receive GXC transfer
    receive() external payable {}

    /**
     * @dev Stake for validator and mint share token to `to` address.
     *      It will emit `Stake` event.
     * @param validator    Validator address
     * @param to           Receiver address
     */
    function stake(address validator, address to) external payable nonReentrant override returns (uint256 shares) {
        require(uint160(validator) > 2000, "StakeManager: invalid validator");
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
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
    
    /**
     * @dev Start unstaking shares for validator.
     *      Stake manager will burn the shares immediately, but return GXC to `to` address after `config.unstakeDelay`.
     *      It will emit `StartUnstake` event.
     * @param validator    Validator address
     * @param to           Receiver address
     * @param shares       Number of shares to be burned
     */
    function startUnstake(address validator, address payable to, uint256 shares) external override nonReentrant returns (uint256 id) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
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
    
    /**
     * @dev Do unstake for all timeout unstake.
     *      This can be called by anyone.
     */
    function doUnstake() external override nonReentrant {
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
    
    // slash logic will be handled by the blockchain
    /*
    function slash(address validator, uint8 reason) external nonReentrant returns (uint256 amount) {
        require(uint160(validator) > 2000, "StakeManager: invalid validator");
        address share = validatorToShare[validator];
        address unstakeShare = validatorToUnstakeShare[validator];
        require(share != address(0) && unstakeShare != address(0), "StakeManager: invalid validator");
        uint8 factor = config.getFactorByReason(reason);
        amount = Share(share).slash(factor).add(Share(unstakeShare).slash(factor));
    }
    */
}