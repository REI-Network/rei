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

    mapping(address => address) private _validatorToShare;
    mapping(address => address) private _validatorToUnstakeShare;
    // all _validators, will not be deleted forever
    address[] private _validators;

    // first unstake id
    uint256 private _firstId = 0;
    // last unstake id
    uint256 private _lastId = 0;
    // unstake information, delete after `do unstake`
    mapping(uint256 => Unstake) private _unstakeQueue;

    /**
     * @dev Emit when the user stakes
     * @param validator     Validator address
     * @param to            Receiver address
     * @param value         Stake value
     * @param shares        Number of shares minted
     */
    event Stake(address indexed validator, address to, uint256 value, uint256 shares);

    /**
     * @dev Emit when the user starts unstake
     * @param id            Unique unstake id
     * @param validator     Validator address
     * @param to            Receiver address
     * @param shares        Number of shares burned
     * @param timestamp     Release timestamp
     */
    event StartUnstake(uint256 indexed id, address indexed validator, address to, uint256 shares, uint256 timestamp);

    /**
     * @dev Emit when stake manager `do unstake`
     * @param id            Unique unstake id
     * @param validator     Validator address
     * @param to            Receiver address
     * @param amount        GXC Released
     */
    event DoUnstake(uint256 indexed id, address indexed validator, address to, uint256 amount);

    constructor(address _config) public {
        config = IConfig(_config);
    }

    /**
     * @dev Visit `_validatorToShare`.
     */
    function validatorToShare(address validator) external view override returns (address) {
        return _validatorToShare[validator];
    }

    /**
     * @dev Visit `_validatorToUnstakeShare`.
     */
    function validatorToUnstakeShare(address validator) external view override returns (address) {
        return _validatorToUnstakeShare[validator];
    }

    /**
     * @dev Get validator by index.
     */
    function validators(uint256 index) external view override returns (address) {
        return _validators[index];
    }

    /**
     * @dev Get the _validators length.
     */
    function validatorsLength() external view override returns (uint256) {
        return _validators.length;
    }

    /**
     * @dev Get the voting power by validator index.
     *      If index is out of range or validator doesn't exist, return 0
     * @param index         The validator index
     */
    function getVotingPowerByIndex(uint256 index) external view override returns (uint256) {
        if (index >= _validators.length) {
            return 0;
        }
        address share = _validatorToShare[_validators[index]];
        if (share == address(0)) {
            return 0;
        }
        return share.balance.div(config.amountPerVotingPower());
    }

    /**
     * @dev Get the voting power by validator address.
     *      If the validator doesn't exist, return 0
     * @param validator     Validator address
     */
    function getVotingPowerByAddess(address validator) external view override returns (uint256) {
        address share = _validatorToShare[validator];
        if (share == address(0)) {
            return 0;
        }
        return share.balance.div(config.amountPerVotingPower());
    }

    /**
     * @dev Get the first unstake id.
     */
    function firstId() external view override returns (uint256) {
        return _firstId;
    }

    /**
     * @dev Get the last unstake id.
     */
    function lastId() external view override returns (uint256) {
        return _lastId;
    }

    /**
     * @dev Get the queued unstake information by unstake index.
     * @param index         Unstake index
     */
    function unstakeQueue(uint256 index) external view override returns (Unstake memory) {
        return _unstakeQueue[index];
    }

    /**
     * @dev Estimate the mininual stake amount for validator.
     *      If the stake amount is less than this value, transaction will fail.
     * @param validator    Validator address
     */
    function estimateMinStakeAmount(address validator) external view override returns (uint256 amount) {
        address share = _validatorToShare[validator];
        if (share == address(0)) {
            amount = config.minStakeAmount();
        } else {
            amount = Share(share).estimateStakeAmount(1);
            if (amount < config.minStakeAmount()) {
                amount = config.minStakeAmount();
            }
        }
    }

    /**
     * @dev Estimate how much GXC should be stake, if user wants to get the number of shares.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateStakeAmount(address validator, uint256 shares) external view override returns (uint256) {
        address share = _validatorToShare[validator];
        if (share == address(0)) {
            return shares;
        }
        return Share(share).estimateStakeAmount(shares);
    }

    /**
     * @dev Estimate the mininual unstake shares for validator.
     *      If the unstake shares is less than this value, transaction will fail.
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     */
    function estimateMinUnstakeShares(address validator) external view override returns (uint256) {
        address share = _validatorToShare[validator];
        if (share == address(0)) {
            return 0;
        }
        return Share(share).estimateUnstakeShares(config.minUnstakeAmount());
    }

    /**
     * @dev Estimate how much shares should be unstake, if user wants to get the amount of GXC.
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param amount       Number of GXC
     */
    function estimateUnstakeShares(address validator, uint256 amount) external view override returns (uint256) {
        address share = _validatorToShare[validator];
        if (share == address(0)) {
            return 0;
        }
        return Share(share).estimateUnstakeShares(amount);
    }

    /**
     * @dev Estimate how much GXC can be claim, if unstake the number of shares(when unstake timeout).
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateUnStakeAmount(address validator, uint256 shares) external view override returns (uint256) {
        address share = _validatorToUnstakeShare[validator];
        if (share == address(0)) {
            return 0;
        }
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
    function stake(address validator, address to) external payable override nonReentrant returns (uint256 shares) {
        require(uint160(validator) > 2000, "StakeManager: invalid validator");
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(msg.value >= config.minStakeAmount(), "StakeManager: invalid stake amount");
        address share = _validatorToShare[validator];
        if (share == address(0)) {
            share = address(new Share(address(config), validator, true));
            _validatorToShare[validator] = share;
            _validatorToUnstakeShare[validator] = address(new Share(address(config), validator, false));
            _validators.push(validator);
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
    function startUnstake(
        address validator,
        address payable to,
        uint256 shares
    ) external override nonReentrant returns (uint256 id) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(shares > 0, "StakeManager: invalid shares");
        address share = _validatorToShare[validator];
        address unstakeShare = _validatorToUnstakeShare[validator];
        require(share != address(0) && unstakeShare != address(0), "StakeManager: invalid validator");

        Share(share).transferFrom(msg.sender, address(this), shares);
        uint256 amount = Share(share).burn(shares, address(this));
        require(amount >= config.minUnstakeAmount(), "StakeManager: invalid unstake amount");
        uint256 unstakeShares = Share(unstakeShare).mint{ value: amount }(address(this));

        id = _lastId;
        _lastId = id.add(1);
        uint256 timestamp = block.timestamp + config.unstakeDelay();
        Unstake memory u = _unstakeQueue[_lastId];
        if (u.validator != address(0) && u.timestamp > timestamp) {
            timestamp = u.timestamp;
        }
        _unstakeQueue[id] = Unstake(validator, to, unstakeShares, timestamp);
        emit StartUnstake(id, validator, to, shares, timestamp);
    }

    /**
     * @dev Do unstake for all timeout unstake.
     *      This can be called by anyone.
     */
    function doUnstake() external override nonReentrant {
        uint256 max = _lastId;
        uint256 id = _firstId;
        for (; id < max; id = id.add(1)) {
            Unstake memory u = _unstakeQueue[id];
            if (u.timestamp <= block.timestamp && gasleft() >= 50000) {
                address unstakeShare = _validatorToUnstakeShare[u.validator];
                require(unstakeShare != address(0), "StakeManager: invalid validator");
                emit DoUnstake(id, u.validator, u.to, Share(unstakeShare).burn(u.unstakeShares, u.to));
                delete _unstakeQueue[id];
            } else {
                break;
            }
        }
        _firstId = id;
    }

    // slash logic will be handled by the blockchain
    /*
    function slash(address validator, uint8 reason) external nonReentrant returns (uint256 amount) {
        require(uint160(validator) > 2000, "StakeManager: invalid validator");
        address share = _validatorToShare[validator];
        address unstakeShare = _validatorToUnstakeShare[validator];
        require(share != address(0) && unstakeShare != address(0), "StakeManager: invalid validator");
        uint8 factor = config.getFactorByReason(reason);
        amount = Share(share).slash(factor).add(Share(unstakeShare).slash(factor));
    }
    */
}
