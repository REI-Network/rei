// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IUnstakePool.sol";
import "./interfaces/IValidatorRewardPool.sol";
import "./interfaces/IStakeManager.sol";
import "./interfaces/IPrison.sol";
import "./CommissionShare.sol";
import "./Only.sol";

contract StakeManager is ReentrancyGuard, Only, IStakeManager {
    using SafeMath for uint256;
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    // auto increment validator id
    uint256 public override validatorId = 0;
    // indexed validator, including all validators with balance
    EnumerableMap.UintToAddressMap private indexedValidators;
    // validator mapping, including all validators
    mapping(address => Validator) public override validators;

    // auto increment unstake id
    uint256 public override unstakeId = 0;
    // unstake information, create at `startUnstake`, delete after `unstake`
    mapping(uint256 => Unstake) public override unstakeQueue;

    // total locked amount
    uint256 public override totalLockedAmount = 0;

    // Deprecate: this variable is kept for forward compatibility only
    // active validator list of next block,
    // this will be set in `afterBlock`
    ActiveValidator[] public override activeValidators;
    // proposer address
    address public override proposer;
    // validator id and priority encoded result
    bytes private activeValidatorInfos;

    // the hash set of the evidence that has been used
    mapping(bytes32 => bool) public override usedEvidence;

    mapping(address => bool) public override freezed;

    /**
     * Emitted when a validator gets a reward
     * NOTE: this event is never shown in the block,
     *       because the `reward` function is only called by the system caller
     * @param validator     Validator address
     * @param value         Reward amount
     */
    event Reward(address indexed validator, uint256 indexed value);

    /**
     * Emitted when the user stakes
     * @param validator     Validator address
     * @param value         Stake value
     * @param to            Receiver address
     * @param shares        Number of shares minted
     */
    event Stake(address indexed validator, uint256 indexed value, address to, uint256 shares);

    /**
     * Emitted when the user starts unstake
     * @param id            Unique unstake id
     * @param validator     Validator address
     * @param value         Stake value
     * @param to            Receiver address
     * @param unstakeShares Number of unstake shares to be burned
     * @param timestamp     Release timestamp
     */
    event StartUnstake(uint256 indexed id, address indexed validator, uint256 indexed value, address to, uint256 unstakeShares, uint256 timestamp);

    /**
     * Emitted when stake manager `unstake`
     * @param id            Unique unstake id
     * @param validator     Validator address
     * @param to            Receiver address
     * @param amount        REI Released
     */
    event DoUnstake(uint256 indexed id, address indexed validator, address to, uint256 amount);

    /**
     * Emitted when validator set commission rate
     * @param validator     Validator address
     * @param rate          New commission rate
     * @param timestamp     Update timestamp
     */
    event SetCommissionRate(address indexed validator, uint256 indexed rate, uint256 indexed timestamp);

    /**
     * Emitted when a new validator is indexed
     * @param validator     Validator address
     * @param votingPower   Validator voting power
     */
    event IndexedValidator(address indexed validator, uint256 indexed votingPower);

    /**
     * Emitted when a new validator is unindexed
     * @param validator     Validator address
     */
    event UnindexedValidator(address indexed validator);

    /**
     * Emitted when a validator is frozen
     * @param validator     Validator address
     */
    event Freeze(address indexed validator);

    event Unfreeze(address indexed validator, uint256 indexed amount);

    constructor(IConfig _config, address _proposer, address[] memory genesisValidators, bytes memory _activeValidators) public Only(_config) {
        for (uint256 i = 0; i < genesisValidators.length; i = i.add(1)) {
            createValidator(genesisValidators[i]);
        }
        proposer = _proposer;
        activeValidatorInfos = _activeValidators;
    }

    /**
     * Only system caller or fee pool can call those functions
     */
    modifier onlySystemCallerOrFeePool() {
        require(msg.sender == config.systemCaller() || msg.sender == config.feePool(), "Only: only system caller or fee pool");
        _;
    }

    modifier unfreezed(address validator) {
        require(!freezed[validator], "StakeManager: validator is freezed");
        _;
    }

    /**
     * Get the indexed validators length.
     */
    function indexedValidatorsLength() external view override returns (uint256) {
        return indexedValidators.length();
    }

    /**
     * Determine whether the index validator exists by id.
     * @param id            The validator id
     */
    function indexedValidatorsExists(uint256 id) external view override returns (bool) {
        return indexedValidators.contains(id);
    }

    /**
     * Get indexed validator address by index.
     * @param index         The validator index
     */
    function indexedValidatorsByIndex(uint256 index) external view override returns (address validator) {
        (, validator) = indexedValidators.at(index);
    }

    /**
     * Get indexed validator address by id.
     * @param id            The validator id
     */
    function indexedValidatorsById(uint256 id) external view override returns (address) {
        return indexedValidators.get(id);
    }

    /**
     * Get the voting power by validator index, if index is out of range or validator doesn't exist, return 0.
     * @param index         The validator index
     */
    function getVotingPowerByIndex(uint256 index) external view override returns (uint256) {
        if (indexedValidators.length() <= index) {
            return 0;
        }
        address validator;
        (, validator) = indexedValidators.at(index);
        address commissionShare = validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            return 0;
        }
        return getVotingPower(commissionShare, validator);
    }

    /**
     * Get the voting power by validator id, if doesn't exist, return 0.
     * @param id            The validator id
     */
    function getVotingPowerById(uint256 id) external view override returns (uint256) {
        address validator = indexedValidators.get(id);
        address commissionShare = validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            return 0;
        }
        return getVotingPower(commissionShare, validator);
    }

    /**
     * Get the voting power by validator address, if the validator doesn't exist, return 0.
     * @param validator     Validator address
     */
    function getVotingPowerByAddress(address validator) public view override returns (uint256) {
        address commissionShare = validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            return 0;
        }
        return getVotingPower(commissionShare, validator);
    }

    /**
     * Get the voting power by validator address.
     * @param commissionShare Validator commission share address
     * @param validator       Validator address
     */
    function getVotingPower(address commissionShare, address validator) private view returns (uint256) {
        return commissionShare.balance.add(IValidatorRewardPool(config.validatorRewardPool()).balanceOf(validator));
    }

    /**
     * Get the total locked amount and the validator count, but no including the `excludes`.
     * @param excludes         Excluded addresses
     */
    function getTotalLockedAmountAndValidatorCount(address[] calldata excludes) external view override returns (uint256 _totalLockedAmount, uint256 validatorCount) {
        _totalLockedAmount = totalLockedAmount;
        validatorCount = indexedValidators.length();
        uint256 minIndexVotingPower = config.minIndexVotingPower();
        for (uint256 i = 0; i < excludes.length; i = i.add(1)) {
            address exclude = excludes[i];
            uint256 votingPower = getVotingPowerByAddress(exclude);
            if (votingPower > 0) {
                _totalLockedAmount = _totalLockedAmount.sub(votingPower);
                if (votingPower > minIndexVotingPower) {
                    validatorCount = validatorCount.sub(1);
                }
            }
        }
    }

    /**
     * Get the active validators list length.
     */
    function activeValidatorsLength() external view override returns (uint256) {
        return activeValidators.length;
    }

    /**
     * Estimate how much REI should be stake, if user wants to get the number of shares, Or estimate how much REI can be obtained, if user unstake the amount of REI.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateSharesToAmount(address validator, uint256 shares) public view override returns (uint256 amount) {
        address commissionShare = validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            amount = shares;
        } else {
            amount = CommissionShare(commissionShare).estimateSharesToAmount(shares);
        }
    }

    /**
     * Estimate how much shares should be unstake, if user wants to get the amount of REI.
     * Or estimate how much shares can be obtained, if user stake the amount of REI.
     * If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param amount       Number of REI
     */
    function estimateAmountToShares(address validator, uint256 amount) public view override returns (uint256 shares) {
        address commissionShare = validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            shares = 0;
        } else {
            shares = CommissionShare(commissionShare).estimateAmountToShares(amount);
        }
    }

    /**
     * Estimate how much REI can be claim, if unstake the number of shares(when unstake timeout).
     * If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateUnstakeAmount(address validator, uint256 shares) external view override returns (uint256 amount) {
        IUnstakePool up = IUnstakePool(config.unstakePool());
        uint256 balance = up.balanceOf(validator);
        uint256 totalSupply = up.totalSupplyOf(validator);
        if (totalSupply == 0) {
            amount = 0;
        } else {
            amount = shares.mul(balance).div(totalSupply);
        }
    }

    // receive REI transfer
    receive() external payable {}

    // create a new validator
    function createValidator(address validator) private returns (Validator memory) {
        require(!Address.isContract(validator), "StakeManager: validator can not be a contract");
        uint256 id = validatorId;
        Validator storage v = validators[validator];
        v.id = id;
        v.commissionShare = address(new CommissionShare(config, validator));
        // don't change the commision rate and the update timestamp
        // the validator may want to set commission rate immediately
        // v.commissionRate = 0;
        // v.updateTimestamp = 0;
        validatorId = id.add(1);
        return v;
    }

    /**
     * Stake for validator and mint share token to `to` address.
     * It will emit `Stake` event.
     * @param validator    Validator address
     * @param to           Receiver address
     */
    function stake(address validator, address to) external payable override nonReentrant unfreezed(validator) returns (uint256 shares) {
        require(uint160(validator) > 2000, "StakeManager: invalid validator");
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(msg.value > 0, "StakeManager: invalid value");

        Validator memory v = validators[validator];
        // if the validator doesn't exist, create a new one
        if (v.commissionShare == address(0)) {
            v = createValidator(validator);
        }
        shares = CommissionShare(v.commissionShare).mint{ value: msg.value }(to);
        // if validator voting power is greater than `minIndexVotingPower`,
        // add it to `indexedValidators`
        if (!_isjailed(validator)) {
            uint256 votingPower = getVotingPower(v.commissionShare, validator);
            if (!indexedValidators.contains(v.id) && votingPower >= config.minIndexVotingPower()) {
                indexedValidators.set(v.id, validator);
                emit IndexedValidator(validator, votingPower.sub(msg.value));
            }
            // increase total locked amount
            totalLockedAmount = totalLockedAmount.add(msg.value);
        }
        emit Stake(validator, msg.value, to, shares);
    }

    /**
     * Do start unstake, it will mint unstake shares and add a record to `unstakeQueue`
     */
    function _startUnstake(address validator, Validator memory v, address payable to, uint256 amount) private returns (uint256 id) {
        if (indexedValidators.contains(v.id) && getVotingPower(v.commissionShare, validator) < config.minIndexVotingPower()) {
            // if the validator's voting power is less than `minIndexVotingPower`, remove him from `indexedValidators`
            indexedValidators.remove(v.id);
            emit UnindexedValidator(validator);
        }

        // deposit unstake amount to `unstakePool`
        uint256 unstakeShares = IUnstakePool(config.unstakePool()).deposit{ value: amount }(validator);

        // create a `Unstake`
        id = unstakeId;
        unstakeId = id.add(1);
        uint256 timestamp = block.timestamp + config.unstakeDelay();
        unstakeQueue[id] = Unstake(validator, to, unstakeShares, timestamp);
        emit StartUnstake(id, validator, amount, to, unstakeShares, timestamp);

        if (!_isjailed(validator)) {
            // decrease total locked amount
            totalLockedAmount = totalLockedAmount.sub(amount);
        }
    }

    /**
     * Start unstake shares for validator.
     * Stake manager will burn the shares immediately, but return REI to `to` address after `config.unstakeDelay`.
     * It will emit `StartUnstake` event.
     * @param validator    Validator address
     * @param to           Receiver address
     * @param shares       Number of shares to be burned
     * @return             Unstake id(if amount is zero, return MAX_UINT256)
     */
    function startUnstake(address validator, address payable to, uint256 shares) external override nonReentrant unfreezed(validator) returns (uint256) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(shares > 0, "StakeManager: invalid shares");
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        CommissionShare(v.commissionShare).transferFrom(msg.sender, address(this), shares);
        uint256 amount = CommissionShare(v.commissionShare).burn(shares);
        if (amount > 0) {
            return _startUnstake(validator, v, to, amount);
        } else {
            return uint256(-1);
        }
    }

    /**
     * Start claim validator reward.
     * Stake manager will claim REI from validator reward manager immediately, but return REI to `to` address after `config.unstakeDelay`.
     * It will emit `StartUnstake` event.
     * @param to           Receiver address
     * @param amount       Number of REI
     * @return             Unstake id
     */
    function startClaim(address payable to, uint256 amount) external override nonReentrant unfreezed(msg.sender) returns (uint256) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(amount > 0, "StakeManager: invalid amount");
        Validator memory v = validators[msg.sender];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        IValidatorRewardPool(config.validatorRewardPool()).claim(msg.sender, amount);
        return _startUnstake(msg.sender, v, to, amount);
    }

    /**
     * Set validator commission rate.
     * @param rate         New commission rate
     */
    function setCommissionRate(uint256 rate) external override nonReentrant {
        require(rate <= 100, "StakeManager: commission rate is too high");
        Validator storage v = validators[msg.sender];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        uint256 updateTimestamp = v.updateTimestamp;
        require(updateTimestamp == 0 || block.timestamp.sub(updateTimestamp) >= config.setCommissionRateInterval(), "StakeManager: update commission rate too frequently");
        require(v.commissionRate != rate, "StakeManager: repeatedly set commission rate");
        v.commissionRate = rate;
        v.updateTimestamp = block.timestamp;
        emit SetCommissionRate(msg.sender, rate, block.timestamp);
    }

    /**
     * Unstake by id, return unstake amount.
     * @param id            Unstake id
     */
    function unstake(uint256 id) external override nonReentrant returns (uint256 amount) {
        Unstake memory u = unstakeQueue[id];
        require(u.validator != address(0), "StakeManager: invalid unstake id");
        require(!freezed[u.validator], "StakeManager: validator is freezed");
        require(u.timestamp <= block.timestamp, "StakeManager: invalid unstake timestamp");
        amount = IUnstakePool(config.unstakePool()).withdraw(u.validator, u.unstakeShares, u.to);
        emit DoUnstake(id, u.validator, u.to, amount);
        delete unstakeQueue[id];
    }

    /**
     * Remove the validator from `indexedValidators` if the voting power is less than `minIndexVotingPower`
     * This can be called by anyone.
     * @param validator           Validator address
     */
    function removeIndexedValidator(address validator) external override nonReentrant {
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0) && indexedValidators.contains(v.id) && getVotingPower(v.commissionShare, validator) < config.minIndexVotingPower(), "StakeManager: invalid validator");
        indexedValidators.remove(v.id);
        emit UnindexedValidator(validator);
    }

    /**
     * Add the validator to `indexedValidators` if the voting power is greater than `minIndexVotingPower`
     * This can be called by anyone.
     * @param validator          Validator address
     */
    function addIndexedValidator(address validator) external override nonReentrant {
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0) && !indexedValidators.contains(v.id), "StakeManager: invalid validator");
        uint256 votingPower = getVotingPower(v.commissionShare, validator);
        require(votingPower >= config.minIndexVotingPower(), "StakeManager: invalid votingPower");
        require(!_isjailed(validator), "StakeManager: jailed validator");
        indexedValidators.set(v.id, validator);
        emit IndexedValidator(validator, votingPower);
    }

    /**
     * Reward validator, only can be called by system caller or fee pool
     * @param validator         Validator address
     */
    function reward(address validator) external payable override nonReentrant onlySystemCallerOrFeePool {
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        uint256 commissionReward = msg.value.mul(v.commissionRate).div(100);
        uint256 validatorReward = msg.value.sub(commissionReward);
        if (commissionReward > 0) {
            CommissionShare(v.commissionShare).reward{ value: commissionReward }();
        }
        if (validatorReward > 0) {
            IValidatorRewardPool(config.validatorRewardPool()).reward{ value: validatorReward }(validator);
        }
        if (!_isjailed(validator) && !freezed[validator]) {
            if (!indexedValidators.contains(v.id)) {
                uint256 votingPower = getVotingPower(v.commissionShare, validator);
                if (votingPower >= config.minIndexVotingPower()) {
                    indexedValidators.set(v.id, validator);
                    emit IndexedValidator(validator, votingPower.sub(msg.value));
                }
            }
            // increase total locked amount
            totalLockedAmount = totalLockedAmount.add(msg.value);
        }

        emit Reward(validator, msg.value);
    }

    /**
     * After block callback, it will be called by system caller after each block is processed
     * @param _proposer               Proposer address
     * @param _activeValidators       Active validator infos
     */
    function onAfterBlock(address _proposer, bytes calldata _activeValidators) external override nonReentrant onlySystemCaller {
        require(_proposer != address(0), "StakeManager: invalid proposer");
        proposer = _proposer;
        activeValidatorInfos = _activeValidators;
    }

    /**
     * Get the validator infos
     */
    function getActiveValidatorInfos() external view override returns (bytes memory) {
        return activeValidatorInfos;
    }

    /**
     * Initialize the evidence hash, called when migrating
     * @param hashes            Evidence hash list
     */
    function initEvidenceHash(bytes32[] calldata hashes) external override onlySystemCaller {
        for (uint256 i = 0; i < hashes.length; i++) {
            usedEvidence[hashes[i]] = true;
        }
    }

    /**
     * Add missRecord, only can be called by system caller
     * @param record        Miss record
     */
    function addMissRecord(MissRecord[] calldata record) external override onlySystemCaller {
        IPrison prison = IPrison(config.prison());
        address[] memory jailedMiners = prison.addMissRecord(record);
        for (uint256 i = 0; i < jailedMiners.length; i = i.add(1)) {
            address validatorAddress = jailedMiners[i];
            Validator memory v = validators[validatorAddress];
            require(v.commissionShare != address(0), "StakeManager: invalid validator");
            if (indexedValidators.contains(v.id)) {
                indexedValidators.remove(v.id);
                emit UnindexedValidator(validatorAddress);
                if (!freezed[validatorAddress]) {
                    totalLockedAmount = totalLockedAmount.sub(getVotingPower(v.commissionShare, validatorAddress));
                }
            }
        }
    }

    /**
     * Unjail from prison
     */
    function unjail() external payable override {
        IPrison prison = IPrison(config.prison());
        prison.unjail{ value: msg.value }(msg.sender);
        Validator memory v = validators[msg.sender];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        if (!freezed[msg.sender]) {
            uint256 votingPower = getVotingPower(v.commissionShare, msg.sender);
            if (!indexedValidators.contains(v.id) && votingPower >= config.minIndexVotingPower()) {
                indexedValidators.set(v.id, msg.sender);
                emit IndexedValidator(msg.sender, votingPower);
            }
            totalLockedAmount = totalLockedAmount.add(votingPower);
        }
    }

    function freeze(address validator, bytes32 hash) external override onlySystemCaller {
        // make sure the evidence is not duplicated
        require(!usedEvidence[hash], "StakeManager: invalid evidence");
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");

        if (indexedValidators.contains(v.id)) {
            // if the validator's voting power is less than `minIndexVotingPower`, remove him from `_indexedValidators`
            indexedValidators.remove(v.id);
            emit UnindexedValidator(validator);
        }

        if (!_isjailed(validator) && !freezed[validator]) {
            // decrease total locked amount
            totalLockedAmount = totalLockedAmount.sub(getVotingPower(v.commissionShare, validator));
        }

        // save evidence hash
        usedEvidence[hash] = true;
        freezed[validator] = true;
        emit Freeze(validator);
    }

    function unfreeze(address validator, uint256 factor) external override returns (uint256 amount) {
        require(msg.sender == config.communityAddress(), "StakeManager: only community can unfreeze");
        require(freezed[validator], "StakeManager: not freezed");

        Validator memory v = validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");

        uint256 decreasedAmount;
        if (factor == 0) {
            //do nothing
        } else if (factor <= 100) {
            decreasedAmount = CommissionShare(v.commissionShare).slash(uint8(factor)).add(IValidatorRewardPool(config.validatorRewardPool()).slash(validator, uint8(factor)));
            amount = decreasedAmount.add(IUnstakePool(config.unstakePool()).slash(validator, uint8(factor)));
        } else {
            decreasedAmount = IValidatorRewardPool(config.validatorRewardPool()).slashV2(validator, factor);
            amount = decreasedAmount;
        }

        if (!_isjailed(validator)) {
            uint256 votingPower = getVotingPower(v.commissionShare, validator);
            if (!indexedValidators.contains(v.id) && votingPower >= config.minIndexVotingPower()) {
                indexedValidators.set(v.id, validator);
                emit IndexedValidator(validator, votingPower);
            }
            totalLockedAmount = totalLockedAmount.add(votingPower);
        }

        freezed[validator] = false;
        emit Unfreeze(validator, amount);
    }

    function _isjailed(address validator) private view returns (bool) {
        (, bool jailed, , , , ) = IPrison(config.prison()).miners(validator);
        return jailed;
    }
}
