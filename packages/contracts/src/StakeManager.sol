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
import "./Estimator.sol";

contract StakeManager is ReentrancyGuard, IStakeManager {
    using SafeMath for uint256;
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    // config
    IConfig public config;
    // estimator
    address private _estimator;

    // auto increment validator id
    uint256 private _validatorId = 0;
    // indexed validator, including all validators with balance
    EnumerableMap.UintToAddressMap private _indexedValidators;
    // validator mapping, including all validators
    mapping(address => Validator) private _validators;

    // auto increment unstake id
    uint256 private _unstakeId = 0;
    // unstake information, delete after `do unstake`
    mapping(uint256 => Unstake) private _unstakeQueue;

    // active validator list of next block
    ActiveValidator[] private _activeValidators;

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
        _estimator = address(new Estimator(_config, address(this)));
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
     * @dev Get the estimator address.
     */
    function estimator() external view override returns (address) {
        return _estimator;
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
     * @dev Get the queued unstake information by unstake id.
     * @param id            Unstake id
     */
    function unstakeQueue(uint256 id) external view override returns (Unstake memory) {
        return _unstakeQueue[id];
    }

    /**
     * @dev Get the active validators list length.
     */
    function activeValidatorsLength() external view override returns (uint256) {
        return _activeValidators.length;
    }

    /**
     * @dev Get the active validator by unstake index.
     * @param index         Active validator index
     */
    function activeValidators(uint256 index) external view override returns (ActiveValidator memory) {
        return _activeValidators[index];
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
            emit IndexedValidator(validator, votingPower.sub(msg.value));
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

        id = _unstakeId;
        uint256 timestamp = block.timestamp + config.unstakeDelay();
        if (id > 0) {
            Unstake memory u = _unstakeQueue[id.sub(1)];
            if (u.validator != address(0) && u.timestamp > timestamp) {
                timestamp = u.timestamp;
            }
        }
        _unstakeQueue[id] = Unstake(validator, to, unstakeShares, timestamp);
        _unstakeId = id.add(1);
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
     * @dev Unstake by id, return unstake amount.
     * @param id            Unstake id
     */
    function unstake(uint256 id) external override nonReentrant returns (uint256 amount) {
        Unstake memory u = _unstakeQueue[id];
        address unstakeKeeper = _validators[u.validator].unstakeKeeper;
        require(unstakeKeeper != address(0), "StakeManager: invalid unstake id");
        require(u.timestamp <= block.timestamp, "StakeManager: invalid unstake timestamp");
        amount = UnstakeKeeper(unstakeKeeper).burn(u.unstakeShares, u.to);
        emit DoUnstake(id, u.validator, u.to, amount);
        delete _unstakeQueue[id];
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
    function reward(address validator) external payable override onlySystemCaller {
        Validator memory v = _validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        uint256 commissionReward = msg.value.mul(v.commissionRate).div(100);
        uint256 validatorReward = msg.value.sub(commissionReward);
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
                emit IndexedValidator(validator, votingPower.sub(msg.value));
            }
        }
    }

    /**
     * @dev After block callback, it will be called by system caller after each block is processed
     * @param acValidators       Active validators list
     * @param priorities         Priority list of active validators
     */
    function afterBlock(address[] calldata acValidators, int256[] calldata priorities) external override onlySystemCaller {
        require(acValidators.length == priorities.length, "StakeManager: invalid list length");
        uint256 orignLength = _activeValidators.length;
        uint256 i = 0;
        for (; i < priorities.length; i = i.add(1)) {
            if (i < orignLength) {
                ActiveValidator storage acValidator = _activeValidators[i];
                acValidator.validator = acValidators[i];
                acValidator.priority = priorities[i];
            } else {
                _activeValidators.push(ActiveValidator(acValidators[i], priorities[i]));
            }
        }
        for (; i < orignLength; i = i.add(1)) {
            _activeValidators.pop();
        }
    }
}
