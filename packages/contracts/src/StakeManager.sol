// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "./interfaces/IConfig.sol";
import "./interfaces/IStakeManager.sol";
import "./CommissionShare.sol";
import "./ValidatorKeeper.sol";
import "./UnstakeKeeper.sol";

contract StakeManager is ReentrancyGuard, IStakeManager {
    using SafeMath for uint256;
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    // config
    IConfig public config;

    // auto increment validator id
    uint256 private _validatorId = 0;
    // indexed validator, including all validators with balance
    EnumerableMap.UintToAddressMap private _indexedValidators;
    // validator mapping, including all validators
    mapping(address => Validator) private _validators;

    // first unstake id
    uint256 private _firstUnstakeId = 0;
    // last unstake id
    uint256 private _lastUnstakeId = 0;
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
     * @param unstakeShares Number of unstake shares to be burned
     * @param timestamp     Release timestamp
     */
    event StartUnstake(uint256 indexed id, address indexed validator, address to, uint256 unstakeShares, uint256 timestamp);

    /**
     * @dev Emit when stake manager `do unstake`
     * @param id            Unique unstake id
     * @param validator     Validator address
     * @param to            Receiver address
     * @param amount        GXC Released
     */
    event DoUnstake(uint256 indexed id, address indexed validator, address to, uint256 amount);

    constructor(address _config, address[] memory genesisValidators) public {
        config = IConfig(_config);
        for (uint256 i = 0; i < genesisValidators.length; i = i.add(1)) {
            // the validator was created, but not added to _indexedValidators
            createValidator(genesisValidators[i], true);
        }
    }

    /**
     * @dev Get the validator information by validator address.
     * @param validator     Validator address
     */
    function validators(address validator) external view override returns (Validator memory) {
        return _validators[validator];
    }

    /**
     * @dev Get the indexed validators length.
     */
    function indexedValidatorsLength() external view override returns (uint256) {
        return _indexedValidators.length();
    }

    /**
     * @dev Get indexed validator address by index.
     * @param index         The validator index
     */
    function indexedValidatorsByIndex(uint256 index) external view override returns (address validator) {
        (, validator) = _indexedValidators.at(index);
    }

    /**
     * @dev Get indexed validator address by id.
     * @param id            The validator id
     */
    function indexedValidatorsById(uint256 id) external view override returns (address) {
        return _indexedValidators.get(id);
    }

    /**
     * @dev Get the voting power by validator index.
     *      If index is out of range or validator doesn't exist, return 0
     * @param index         The validator index
     */
    function getVotingPowerByIndex(uint256 index) external view override returns (uint256) {
        if (_indexedValidators.length() <= index) {
            return 0;
        }
        address validator;
        (, validator) = _indexedValidators.at(index);
        address commissionShare = _validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            return 0;
        }
        return commissionShare.balance.div(config.amountPerVotingPower());
    }

    /**
     * @dev Get the voting power by validator id.
     *      If doesn't exist, return 0
     * @param id            The validator id
     */
    function getVotingPowerById(uint256 id) external view override returns (uint256) {
        address commissionShare = _validators[_indexedValidators.get(id)].commissionShare;
        if (commissionShare == address(0)) {
            return 0;
        }
        return commissionShare.balance.div(config.amountPerVotingPower());
    }

    /**
     * @dev Get the voting power by validator address.
     *      If the validator doesn't exist, return 0
     * @param validator     Validator address
     */
    function getVotingPowerByAddess(address validator) external view override returns (uint256) {
        address commissionShare = _validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            return 0;
        }
        return commissionShare.balance.div(config.amountPerVotingPower());
    }

    /**
     * @dev Get the first unstake id.
     */
    function firstUnstakeId() external view override returns (uint256) {
        return _firstUnstakeId;
    }

    /**
     * @dev Get the last unstake id.
     */
    function lastUnstakeId() external view override returns (uint256) {
        return _lastUnstakeId;
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
        address commissionShare = _validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            amount = config.minStakeAmount();
        } else {
            amount = CommissionShare(commissionShare).estimateStakeAmount(1);
            uint256 shares = CommissionShare(commissionShare).estimateUnstakeShares(amount);
            if (shares == 0) {
                amount = amount.add(1);
            }
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
    function estimateStakeAmount(address validator, uint256 shares) external view override returns (uint256 amount) {
        address commissionShare = _validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            return shares;
        }
        amount = CommissionShare(commissionShare).estimateStakeAmount(shares);
        uint256 shares2 = CommissionShare(commissionShare).estimateUnstakeShares(amount);
        if (shares2 < shares) {
            amount = amount.add(1);
        }
    }

    /**
     * @dev Estimate the mininual unstake shares for validator.
     *      If the unstake shares is less than this value, transaction will fail.
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     */
    function estimateMinUnstakeShares(address validator) external view override returns (uint256 shares) {
        address commissionShare = _validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            shares = 0;
        } else {
            shares = CommissionShare(commissionShare).estimateUnstakeShares(config.minUnstakeAmount());
            if (shares == 0) {
                shares = 1;
            } else {
                uint256 amount = CommissionShare(commissionShare).estimateStakeAmount(shares);
                if (amount < config.minUnstakeAmount()) {
                    shares = shares.add(1);
                }
            }
        }
    }

    /**
     * @dev Estimate how much shares should be unstake, if user wants to get the amount of GXC.
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param amount       Number of GXC
     */
    function estimateUnstakeShares(address validator, uint256 amount) external view override returns (uint256 shares) {
        address commissionShare = _validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            shares = 0;
        } else {
            shares = CommissionShare(commissionShare).estimateUnstakeShares(amount);
            if (shares == 0) {
                shares = 1;
            } else {
                uint256 amount2 = CommissionShare(commissionShare).estimateStakeAmount(shares);
                if (amount2 < amount) {
                    shares = shares.add(1);
                }
            }
        }
    }

    /**
     * @dev Estimate how much GXC can be claim, if unstake the number of shares(when unstake timeout).
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateUnstakeAmount(address validator, uint256 shares) external view override returns (uint256) {
        address unstakeKeeper = _validators[validator].unstakeKeeper;
        if (unstakeKeeper == address(0)) {
            return 0;
        }
        return UnstakeKeeper(unstakeKeeper).estimateUnstakeAmount(shares);
    }

    // receive GXC transfer
    receive() external payable {}

    // create a new validator
    function createValidator(address validator, bool isGenesis) private returns (address commissionShare) {
        uint256 id = _validatorId;
        Validator storage v = _validators[validator];
        v.id = id;
        v.validatorKeeper = address(new ValidatorKeeper(address(config), validator));
        commissionShare = address(new CommissionShare(address(config), validator));
        v.commissionShare = commissionShare;
        v.unstakeKeeper = address(new UnstakeKeeper(address(config), validator));
        // don't change the commision rate and the update timestamp
        // the validator may want to set commission rate immediately
        // v.commissionRate = 0;
        // v.updateTimestamp = 0;
        _validatorId = id.add(1);
        if (!isGenesis) {
            _indexedValidators.set(id, validator);
        }
    }

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
        address commissionShare = _validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            commissionShare = createValidator(validator, false);
        }
        shares = CommissionShare(commissionShare).mint{ value: msg.value }(to);
        emit Stake(validator, to, msg.value, shares);
    }

    /**
     * @dev Do start unstake.
     *      It will mint unstake shares to self and add a record to `_unstakeQueue`
     */
    function doStartUnstake(
        address validator,
        address unstakeKeeper,
        address payable to,
        uint256 amount
    ) private returns (uint256 id) {
        uint256 unstakeShares = UnstakeKeeper(unstakeKeeper).mint{ value: amount }();

        id = _lastUnstakeId;
        uint256 timestamp = block.timestamp + config.unstakeDelay();
        if (id > 0) {
            Unstake memory u = _unstakeQueue[id.sub(1)];
            if (u.validator != address(0) && u.timestamp > timestamp) {
                timestamp = u.timestamp;
            }
        }
        _unstakeQueue[id] = Unstake(validator, to, unstakeShares, timestamp);
        _lastUnstakeId = id.add(1);
        emit StartUnstake(id, validator, to, unstakeShares, timestamp);
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
    ) external override nonReentrant returns (uint256) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(shares > 0, "StakeManager: invalid shares");
        Validator memory v = _validators[validator];
        address commissionShare = v.commissionShare;
        address unstakeKeeper = v.unstakeKeeper;
        require(commissionShare != address(0) && unstakeKeeper != address(0), "StakeManager: invalid validator");

        CommissionShare(commissionShare).transferFrom(msg.sender, address(this), shares);
        uint256 amount = CommissionShare(commissionShare).burn(shares, address(this));
        require(amount >= config.minUnstakeAmount(), "StakeManager: invalid unstake amount");
        if (commissionShare.balance == 0) {
            _indexedValidators.remove(v.id);
        }
        return doStartUnstake(validator, unstakeKeeper, to, amount);
    }

    /**
     * @dev Start claim validator reward.
     *      Stake claim GXC from keeper immediately, but return GXC to `to` address after `config.unstakeDelay`.
     *      It will emit `StartUnstake` event.
     * @param to           Receiver address
     * @param amount       Number of GXC
     */
    function startClaim(address payable to, uint256 amount) external override nonReentrant returns (uint256) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(amount >= config.minUnstakeAmount(), "StakeManager: invalid unstake amount");
        Validator memory v = _validators[msg.sender];
        address validatorKeeper = v.validatorKeeper;
        address unstakeKeeper = v.unstakeKeeper;
        require(validatorKeeper != address(0) && unstakeKeeper != address(0), "StakeManager: invalid validator");

        ValidatorKeeper(validatorKeeper).claim(amount, address(this));
        return doStartUnstake(msg.sender, unstakeKeeper, to, amount);
    }

    /**
     * @dev Set validator commission rate.
     * @param rate         New commission rate
     */
    function setCommissionRate(uint256 rate) external override {
        require(rate <= config.maxCommissionRate(), "StakeManager: commission rate is too high");
        Validator storage v = _validators[msg.sender];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        uint256 updateTimestamp = v.updateTimestamp;
        require(updateTimestamp == 0 || block.timestamp.sub(updateTimestamp) >= 24 hours, "StakeManager: update commission rate too frequently");
        require(v.commissionRate != rate, "StakeManager: repeatedly set commission rate");
        v.commissionRate = rate;
        v.updateTimestamp = block.timestamp;
    }

    /**
     * @dev Do unstake for all timeout unstake.
     *      This can be called by anyone.
     */
    function doUnstake() external override nonReentrant {
        uint256 max = _lastUnstakeId;
        uint256 id = _firstUnstakeId;
        for (; id < max; id = id.add(1)) {
            if (gasleft() < 50000) {
                break;
            }

            Unstake memory u = _unstakeQueue[id];
            if (u.timestamp <= block.timestamp) {
                address unstakeKeeper = _validators[u.validator].unstakeKeeper;
                require(unstakeKeeper != address(0), "StakeManager: invalid validator");
                emit DoUnstake(id, u.validator, u.to, UnstakeKeeper(unstakeKeeper).burn(u.unstakeShares, u.to));
                delete _unstakeQueue[id];
            } else {
                break;
            }
        }
        require(id != _firstUnstakeId, "StakeManager: useless call, revert");
        _firstUnstakeId = id;
    }
}
