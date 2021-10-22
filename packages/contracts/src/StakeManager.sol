// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "./interfaces/IUnstakePool.sol";
import "./interfaces/IValidatorRewardPool.sol";
import "./interfaces/IStakeManager.sol";
import "./libraries/Util.sol";
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

    // active validator list of next block,
    // this will be set in `afterBlock`
    ActiveValidator[] public override activeValidators;

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
     * @dev Emit when stake manager `unstake`
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

    constructor(IConfig _config, address[] memory genesisValidators) public Only(_config) {
        for (uint256 i = 0; i < genesisValidators.length; i = i.add(1)) {
            // the validator was created, but not added to `indexedValidators`
            createValidator(genesisValidators[i]);
        }
    }

    modifier onlyRouterOrFeePool() {
        require(msg.sender == config.router() || msg.sender == config.feePool(), "StakeManager: only router or fee pool");
        _;
    }

    /**
     * @dev Get the indexed validators length.
     */
    function indexedValidatorsLength() external view override returns (uint256) {
        return indexedValidators.length();
    }

    /**
     * @dev Determine whether the index validator exists by id.
     * @param id            The validator id
     */
    function indexedValidatorsExists(uint256 id) external view override returns (bool) {
        return indexedValidators.contains(id);
    }

    /**
     * @dev Get indexed validator address by index.
     * @param index         The validator index
     */
    function indexedValidatorsByIndex(uint256 index) external view override returns (address validator) {
        (, validator) = indexedValidators.at(index);
    }

    /**
     * @dev Get indexed validator address by id.
     * @param id            The validator id
     */
    function indexedValidatorsById(uint256 id) external view override returns (address) {
        return indexedValidators.get(id);
    }

    /**
     * @dev Get the voting power by validator index.
     *      If index is out of range or validator doesn't exist, return 0
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
     * @dev Get the voting power by validator id.
     *      If doesn't exist, return 0
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
     * @dev Get the voting power by validator address.
     *      If the validator doesn't exist, return 0
     * @param validator     Validator address
     */
    function getVotingPowerByAddress(address validator) external view override returns (uint256) {
        address commissionShare = validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            return 0;
        }
        return getVotingPower(commissionShare, validator);
    }

    /**
     * @dev Get the voting power by validator address.
     * @param commissionShare Validator commission share address
     * @param validator       Validator address
     */
    function getVotingPower(address commissionShare, address validator) private view returns (uint256) {
        return commissionShare.balance.add(IValidatorRewardPool(config.validatorRewardPool()).balanceOf(validator));
    }

    /**
     * @dev Get the active validators list length.
     */
    function activeValidatorsLength() external view override returns (uint256) {
        return activeValidators.length;
    }

    /**
     * @dev Estimate how much GXC should be stake, if user wants to get the number of shares.
     *      Or Estimate how much GXC can be obtained, if user unstake the amount of GXC.
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
     * @dev Estimate how much shares should be unstake, if user wants to get the amount of GXC.
     *      Or estimate how much shares can be obtained, if user stake the amount of GXC.
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param amount       Number of GXC
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
     * @dev Estimate how much GXC can be claim, if unstake the number of shares(when unstake timeout).
     *      If the validator doesn't exist, return 0.
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

    // receive GXC transfer
    receive() external payable {}

    // create a new validator
    function createValidator(address validator) private returns (Validator memory) {
        require(!Util.isContract(validator), "StakeManager: validator can not be a contract");
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
     * @dev Stake for validator and mint share token to `to` address.
     *      It will emit `Stake` event.
     * @param validator    Validator address
     * @param to           Receiver address
     */
    function stake(address validator, address to) external payable override nonReentrant returns (uint256 shares) {
        require(uint160(validator) > 2000, "StakeManager: invalid validator");
        if (uint160(msg.sender) > 2000) {
            require(uint160(to) > 2000, "StakeManager: invalid receiver");
        }
        require(msg.value > 0, "StakeManager: invalid value");

        Validator memory v = validators[validator];
        // if the validator doesn't exist, create a new one
        if (v.commissionShare == address(0)) {
            v = createValidator(validator);
        }
        shares = CommissionShare(v.commissionShare).mint{ value: msg.value }(to);
        // if validator voting power is greater than `minIndexVotingPower`,
        // add it to `indexedValidators`
        uint256 votingPower = getVotingPower(v.commissionShare, validator);
        if (!indexedValidators.contains(v.id) && votingPower >= config.minIndexVotingPower()) {
            indexedValidators.set(v.id, validator);
            emit IndexedValidator(validator, votingPower.sub(msg.value));
        }
        emit Stake(validator, msg.value, to, shares);

        // increase total locked amount
        totalLockedAmount = totalLockedAmount.add(msg.value);
    }

    /**
     * @dev Do start unstake.
     *      It will mint unstake shares and add a record to `unstakeQueue`
     */
    function _startUnstake(
        address validator,
        Validator memory v,
        address payable to,
        uint256 amount
    ) private returns (uint256 id) {
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

        // decrease total locked amount
        totalLockedAmount = totalLockedAmount.sub(amount);
    }

    /**
     * @dev Start unstake shares for validator.
     *      Stake manager will burn the shares immediately, but return GXC to `to` address after `config.unstakeDelay`.
     *      It will emit `StartUnstake` event.
     * @param validator    Validator address
     * @param to           Receiver address
     * @param shares       Number of shares to be burned
     * @return             Unstake id(if amount is zero, return MAX_UINT256)
     */
    function startUnstake(
        address validator,
        address payable to,
        uint256 shares
    ) external override nonReentrant returns (uint256) {
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
     * @dev Start claim validator reward.
     *      Stake manager will claim GXC from validator reward manager immediately, but return GXC to `to` address after `config.unstakeDelay`.
     *      It will emit `StartUnstake` event.
     * @param to           Receiver address
     * @param amount       Number of GXC
     * @return             Unstake id
     */
    function startClaim(address payable to, uint256 amount) external override nonReentrant returns (uint256) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(amount > 0, "StakeManager: invalid amount");
        Validator memory v = validators[msg.sender];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        IValidatorRewardPool(config.validatorRewardPool()).claim(msg.sender, amount);
        return _startUnstake(msg.sender, v, to, amount);
    }

    /**
     * @dev Set validator commission rate.
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
     * @dev Unstake by id, return unstake amount.
     * @param id            Unstake id
     */
    function unstake(uint256 id) external override nonReentrant returns (uint256 amount) {
        Unstake memory u = unstakeQueue[id];
        require(u.validator != address(0), "StakeManager: invalid unstake id");
        require(u.timestamp <= block.timestamp, "StakeManager: invalid unstake timestamp");
        amount = IUnstakePool(config.unstakePool()).withdraw(u.validator, u.unstakeShares, u.to);
        emit DoUnstake(id, u.validator, u.to, amount);
        delete unstakeQueue[id];
    }

    /**
     * @dev Remove the validator from `indexedValidators` if the voting power is less than `minIndexVotingPower`
     *      This can be called by anyone.
     * @param validator           Validator address
     */
    function removeIndexedValidator(address validator) external override nonReentrant {
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0) && indexedValidators.contains(v.id) && getVotingPower(v.commissionShare, validator) < config.minIndexVotingPower(), "StakeManager: invalid validator");
        indexedValidators.remove(v.id);
        emit UnindexedValidator(validator);
    }

    /**
     * @dev Add the validator to `indexedValidators` if the voting power is greater than `minIndexVotingPower`
     *      This can be called by anyone.
     * @param validator          Validator address
     */
    function addIndexedValidator(address validator) external override nonReentrant {
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0) && !indexedValidators.contains(v.id), "StakeManager: invalid validator");
        uint256 votingPower = getVotingPower(v.commissionShare, validator);
        require(votingPower >= config.minIndexVotingPower());
        indexedValidators.set(v.id, validator);
        emit IndexedValidator(validator, votingPower);
    }

    /**
     * @dev Reward validator, only can be called by system caller
     * @param validator         Validator address
     */
    function reward(address validator) external payable override nonReentrant onlyRouterOrFeePool {
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
        if (!indexedValidators.contains(v.id)) {
            uint256 votingPower = getVotingPower(v.commissionShare, validator);
            if (votingPower >= config.minIndexVotingPower()) {
                indexedValidators.set(v.id, validator);
                emit IndexedValidator(validator, votingPower.sub(msg.value));
            }
        }
        emit Stake(validator, msg.value, address(0), 0);

        // increase total locked amount
        totalLockedAmount = totalLockedAmount.add(msg.value);
    }

    /**
     * @dev Slash validator, only can be called by system caller
     * @param validator         Validator address
     * @param reason            Slash reason
     */
    function slash(address validator, uint8 reason) external override nonReentrant onlyRouter returns (uint256 amount) {
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        uint8 factor = config.getFactorByReason(reason);
        uint256 decreasedAmount = CommissionShare(v.commissionShare).slash(factor).add(IValidatorRewardPool(config.validatorRewardPool()).slash(validator, factor));
        amount = decreasedAmount.add(IUnstakePool(config.unstakePool()).slash(validator, factor));
        if (indexedValidators.contains(v.id) && getVotingPower(v.commissionShare, validator) < config.minIndexVotingPower()) {
            // if the validator's voting power is less than `minIndexVotingPower`, remove him from `_indexedValidators`
            indexedValidators.remove(v.id);
            emit UnindexedValidator(validator);
        }
        // TODO: emit a event

        // decrease total locked amount
        totalLockedAmount = totalLockedAmount.sub(decreasedAmount);
    }

    // TODO: if the active validators list is exactly the same as the last list, don't modify the storage
    /**
     * @dev After block callback, it will be called by system caller after each block is processed
     * @param acValidators       Active validators list
     * @param priorities         Priority list of active validators
     */
    function onAfterBlock(address[] calldata acValidators, int256[] calldata priorities) external override nonReentrant onlyRouter {
        require(acValidators.length == priorities.length, "StakeManager: invalid list length");
        uint256 originLength = activeValidators.length;
        uint256 i = 0;
        for (; i < priorities.length; i = i.add(1)) {
            if (i < originLength) {
                ActiveValidator storage acValidator = activeValidators[i];
                acValidator.validator = acValidators[i];
                acValidator.priority = priorities[i];
            } else {
                activeValidators.push(ActiveValidator(acValidators[i], priorities[i]));
            }
        }
        for (; i < originLength; i = i.add(1)) {
            activeValidators.pop();
        }
    }
}
