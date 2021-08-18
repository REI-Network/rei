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
     * @param value         Stake value
     * @param to            Receiver address
     * @param shares        Number of shares minted
     */
    event Stake(address indexed validator, uint256 indexed value, address to, uint256 shares);

    /**
     * @dev Emit when the user starts unstake
     * @param id            Unique unstake id
     * @param validator     Validator address
     * @param value         Stake value
     * @param to            Receiver address
     * @param unstakeShares Number of unstake shares to be burned
     * @param timestamp     Release timestamp
     */
    event StartUnstake(uint256 indexed id, address indexed validator, uint256 indexed value, address to, uint256 unstakeShares, uint256 timestamp);

    /**
     * @dev Emit when stake manager `do unstake`
     * @param id            Unique unstake id
     * @param validator     Validator address
     * @param to            Receiver address
     * @param amount        GXC Released
     */
    event DoUnstake(uint256 indexed id, address indexed validator, address to, uint256 amount);

    /**
     * @dev Emit when validator set commission rate
     * @param validator     Validator address
     * @param rate          New commission rate
     * @param timestamp     Update timestamp
     */
    event SetCommissionRate(address indexed validator, uint256 indexed rate, uint256 indexed timestamp);

    /**
     * @dev Emit when a new validator is indexed
     * @param validator     Validator address
     * @param votingPower   Validator voting power
     */
    event IndexedValidator(address indexed validator, uint256 indexed votingPower);

    /**
     * @dev Emit when a new validator is unindexed
     * @param validator     Validator address
     */
    event UnindexedValidator(address indexed validator);

    constructor(address _config, address[] memory genesisValidators) public {
        config = IConfig(_config);
        for (uint256 i = 0; i < genesisValidators.length; i = i.add(1)) {
            // the validator was created, but not added to `_indexedValidators`
            createValidator(genesisValidators[i]);
        }
    }

    modifier onlySystemCaller() {
        require(msg.sender == config.systemCaller(), "StakeManager: invalid caller");
        _;
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
     * @dev Determine whether the index validator exists by id.
     * @param id            The validator id
     */
    function indexedValidatorsExists(uint256 id) external view override returns (bool) {
        return _indexedValidators.contains(id);
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
        return getVotingPower(_validators[validator]);
    }

    /**
     * @dev Get the voting power by validator id.
     *      If doesn't exist, return 0
     * @param id            The validator id
     */
    function getVotingPowerById(uint256 id) external view override returns (uint256) {
        return getVotingPower(_validators[_indexedValidators.get(id)]);
    }

    /**
     * @dev Get the voting power by validator address.
     *      If the validator doesn't exist, return 0
     * @param validator     Validator address
     */
    function getVotingPowerByAddress(address validator) external view override returns (uint256) {
        return getVotingPower(_validators[validator]);
    }

    /**
     * @dev Get the voting power by validator address.
     *      If the validator doesn't exist, return 0
     * @param v              Validator
     */
    function getVotingPower(Validator memory v) private view returns (uint256) {
        if (v.commissionShare == address(0) || v.validatorKeeper == address(0)) {
            return 0;
        }
        return v.commissionShare.balance.add(v.validatorKeeper.balance);
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

    // receive GXC transfer
    receive() external payable {}

    // create a new validator
    function createValidator(address validator) private returns (Validator memory) {
        uint256 id = _validatorId;
        Validator storage v = _validators[validator];
        v.id = id;
        v.validatorKeeper = address(new ValidatorKeeper(address(config), validator));
        v.commissionShare = address(new CommissionShare(address(config), validator));
        v.unstakeKeeper = address(new UnstakeKeeper(address(config), validator));
        // don't change the commision rate and the update timestamp
        // the validator may want to set commission rate immediately
        // v.commissionRate = 0;
        // v.updateTimestamp = 0;
        _validatorId = id.add(1);
        return v;
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

        Validator memory v = _validators[validator];
        // if the validator doesn't exist, create a new one
        if (v.commissionShare == address(0)) {
            v = createValidator(validator);
        }
        shares = CommissionShare(v.commissionShare).mint{ value: msg.value }(to);
        // if validator voting power is greater than `minIndexVotingPower`,
        // add it to `_indexedValidators`
        uint256 votingPower = getVotingPower(v);
        if (!_indexedValidators.contains(v.id) && votingPower >= config.minIndexVotingPower()) {
            _indexedValidators.set(v.id, validator);
            emit IndexedValidator(validator, votingPower);
        }
        emit Stake(validator, msg.value, to, shares);
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
        emit StartUnstake(id, validator, amount, to, unstakeShares, timestamp);
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
        require(v.commissionShare != address(0) && v.unstakeKeeper != address(0), "StakeManager: invalid validator");

        CommissionShare(v.commissionShare).transferFrom(msg.sender, address(this), shares);
        uint256 amount = CommissionShare(v.commissionShare).burn(shares, address(this));
        require(amount >= config.minUnstakeAmount(), "StakeManager: invalid unstake amount");
        if (_indexedValidators.contains(v.id) && getVotingPower(v) < config.minIndexVotingPower()) {
            // if the validator's voting power is less than `minIndexVotingPower`, remove him from `_indexedValidators`
            _indexedValidators.remove(v.id);
            emit UnindexedValidator(validator);
        }
        return doStartUnstake(validator, v.unstakeKeeper, to, amount);
    }

    /**
     * @dev Start claim validator reward.
     *      Stake manager will claim GXC from validator keeper immediately, but return GXC to `to` address after `config.unstakeDelay`.
     *      It will emit `StartUnstake` event.
     * @param to           Receiver address
     * @param amount       Number of GXC
     */
    function startClaim(address payable to, uint256 amount) external override nonReentrant returns (uint256) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(amount >= config.minUnstakeAmount(), "StakeManager: invalid unstake amount");
        Validator memory v = _validators[msg.sender];
        require(v.validatorKeeper != address(0) && v.unstakeKeeper != address(0), "StakeManager: invalid validator");

        ValidatorKeeper(v.validatorKeeper).claim(amount, address(this));
        if (_indexedValidators.contains(v.id) && getVotingPower(v) < config.minIndexVotingPower()) {
            // if the validator's voting power is less than `minIndexVotingPower`, remove him from `_indexedValidators`
            _indexedValidators.remove(v.id);
            emit UnindexedValidator(msg.sender);
        }
        return doStartUnstake(msg.sender, v.unstakeKeeper, to, amount);
    }

    /**
     * @dev Set validator commission rate.
     * @param rate         New commission rate
     */
    function setCommissionRate(uint256 rate) external override {
        require(rate <= 100, "StakeManager: commission rate is too high");
        Validator storage v = _validators[msg.sender];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        uint256 updateTimestamp = v.updateTimestamp;
        require(updateTimestamp == 0 || block.timestamp.sub(updateTimestamp) >= config.setCommissionRateInterval(), "StakeManager: update commission rate too frequently");
        require(v.commissionRate != rate, "StakeManager: repeatedly set commission rate");
        v.commissionRate = rate;
        v.updateTimestamp = block.timestamp;
        emit SetCommissionRate(msg.sender, rate, block.timestamp);
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

    /**
     * @dev Remove the validator from `_indexedValidators` if the voting power is less than `minIndexVotingPower`
     *      This can be called by anyone.
     * @param validator           Validator address
     */
    function removeIndexedValidator(address validator) external override {
        Validator memory v = _validators[validator];
        require(v.commissionShare != address(0) && v.validatorKeeper != address(0) && _indexedValidators.contains(v.id) && getVotingPower(v) < config.minIndexVotingPower(), "StakeManager: invalid validator");
        _indexedValidators.remove(v.id);
        emit UnindexedValidator(validator);
    }

    /**
     * @dev Add the validator to `_indexedValidators` if the voting power is greater than `minIndexVotingPower`
     *      This can be called by anyone.
     * @param validator          Validator address
     */
    function addIndexedValidator(address validator) external override {
        Validator memory v = _validators[validator];
        require(v.commissionShare != address(0) && v.validatorKeeper != address(0) && !_indexedValidators.contains(v.id), "StakeManager: invalid validator");
        uint256 votingPower = getVotingPower(v);
        require(votingPower >= config.minIndexVotingPower());
        _indexedValidators.set(v.id, validator);
        emit IndexedValidator(validator, votingPower);
    }

    /**
     * @dev Reward validator, only can be called by system caller
     * @param validator         Validator address
     */
    function reward(address validator) external payable override onlySystemCaller returns (uint256 validatorReward, uint256 commissionReward) {
        Validator memory v = _validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        commissionReward = msg.value.mul(v.commissionRate).div(100);
        validatorReward = msg.value.sub(commissionReward);
        if (commissionReward > 0) {
            CommissionShare(v.commissionShare).reward{ value: commissionReward }();
        }
        if (validatorReward > 0) {
            ValidatorKeeper(v.validatorKeeper).reward{ value: validatorReward }();
        }
        if (!_indexedValidators.contains(v.id)) {
            uint256 votingPower = getVotingPower(v);
            if (votingPower >= config.minIndexVotingPower()) {
                _indexedValidators.set(v.id, validator);
                emit IndexedValidator(validator, votingPower);
            }
        }
    }

    /**
     * @dev Slash validator, only can be called by system caller
     *      After all keepers slash themselves and transfer reduced amount to the stake manager,
     *      blockchain will burn the balance of stake manager
     * @param validator         Validator address
     * @param reason            Slash reason
     */
    function slash(address validator, uint8 reason) external override onlySystemCaller returns (uint256 amount) {
        Validator memory v = _validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        uint8 factor = config.getFactorByReason(reason);
        amount = CommissionShare(v.commissionShare).slash(factor).add(ValidatorKeeper(v.validatorKeeper).slash(factor)).add(UnstakeKeeper(v.unstakeKeeper).slash(factor));
        if (_indexedValidators.contains(v.id) && getVotingPower(v) < config.minIndexVotingPower()) {
            _indexedValidators.remove(v.id);
            emit UnindexedValidator(validator);
        }
    }
}
