// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "./interfaces/IStakeManager.sol";
import "./interfaces/IUnstakeManager.sol";
import "./interfaces/IValidatorRewardManager.sol";
import "./CommissionShare.sol";
import "./Only.sol";

contract StakeManager is ReentrancyGuard, Only {
    using SafeMath for uint256;
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    // auto increment validator id
    uint256 public validatorId = 0;
    // indexed validator, including all validators with balance
    EnumerableMap.UintToAddressMap private indexedValidators;
    // validator mapping, including all validators
    mapping(address => Validator) public validators;

    // auto increment unstake id
    uint256 public unstakeId = 0;
    // unstake information, create at `startUnstake`, delete after `unstake`
    mapping(uint256 => Unstake) public unstakeQueue;

    // unstake manager
    IUnstakeManager public unstakeManager;
    // validator reward manager
    IValidatorRewardManager public validatorRewardManager;

    // active validator list of next block,
    // this will be set in `afterBlock`
    ActiveValidator[] public activeValidators;

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
        unstakeManager = IUnstakeManager(config.unstakeManager());
        validatorRewardManager = IValidatorRewardManager(config.validatorRewardManager());
        for (uint256 i = 0; i < genesisValidators.length; i = i.add(1)) {
            // the validator was created, but not added to `indexedValidators`
            createValidator(genesisValidators[i]);
        }
    }

    /**
     * @dev Get the indexed validators length.
     */
    function indexedValidatorsLength() external view returns (uint256) {
        return indexedValidators.length();
    }

    /**
     * @dev Determine whether the index validator exists by id.
     * @param id            The validator id
     */
    function indexedValidatorsExists(uint256 id) external view returns (bool) {
        return indexedValidators.contains(id);
    }

    /**
     * @dev Get indexed validator address by index.
     * @param index         The validator index
     */
    function indexedValidatorsByIndex(uint256 index) external view returns (address validator) {
        (, validator) = indexedValidators.at(index);
    }

    /**
     * @dev Get indexed validator address by id.
     * @param id            The validator id
     */
    function indexedValidatorsById(uint256 id) external view returns (address) {
        return indexedValidators.get(id);
    }

    /**
     * @dev Get the voting power by validator index.
     *      If index is out of range or validator doesn't exist, return 0
     * @param index         The validator index
     */
    function getVotingPowerByIndex(uint256 index) external view returns (uint256) {
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
    function getVotingPowerById(uint256 id) external view returns (uint256) {
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
    function getVotingPowerByAddress(address validator) external view returns (uint256) {
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
        return commissionShare.balance.add(validatorRewardManager.balanceOf(validator));
    }

    /**
     * @dev Get the active validators list length.
     */
    function activeValidatorsLength() external view returns (uint256) {
        return activeValidators.length;
    }

    /**
     * @dev Estimate the mininual stake amount for validator.
     *      If the stake amount is less than this value, transaction will fail.
     * @param validator    Validator address
     */
    function estimateMinStakeAmount(address validator) external view returns (uint256 amount) {
        return estimateStakeAmount(validator, 1);
    }

    /**
     * @dev Estimate how much GXC should be stake, if user wants to get the number of shares.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateStakeAmount(address validator, uint256 shares) public view returns (uint256 amount) {
        address commissionShare = validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            amount = shares;
        } else {
            amount = CommissionShare(commissionShare).estimateStakeAmount(shares);
        }
    }

    /**
     * @dev Estimate the mininual unstake shares for validator.
     *      If the unstake shares is less than this value, transaction will fail.
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     */
    function estimateMinUnstakeShares(address validator) external view returns (uint256 shares) {
        return estimateUnstakeShares(validator, 1);
    }

    /**
     * @dev Estimate how much shares should be unstake, if user wants to get the amount of GXC.
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param amount       Number of GXC
     */
    function estimateUnstakeShares(address validator, uint256 amount) public view returns (uint256 shares) {
        address commissionShare = validators[validator].commissionShare;
        if (commissionShare == address(0)) {
            shares = 0;
        } else {
            shares = CommissionShare(commissionShare).estimateUnstakeShares(amount);
        }
    }

    /**
     * @dev Estimate how much GXC can be claim, if unstake the number of shares(when unstake timeout).
     *      If the validator doesn't exist, return 0.
     * @param validator    Validator address
     * @param shares       Number of shares
     */
    function estimateUnstakeAmount(address validator, uint256 shares) external view returns (uint256 amount) {
        uint256 balance = unstakeManager.balanceOf(validator);
        uint256 totalSupply = unstakeManager.totalSupplyOf(validator);
        if (totalSupply == 0) {
            amount = 0;
        } else {
            amount = shares.mul(balance).div(totalSupply);
        }
    }

    // receive GXC transfer
    receive() external payable {}

    // check if the address is a contract
    function isContract(address addr) private view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        return size > 0;
    }

    // create a new validator
    function createValidator(address validator) private returns (Validator memory) {
        require(!isContract(validator), "StakeManager: validator can not be a contract");
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
    function stake(address validator, address to) external payable nonReentrant returns (uint256 shares) {
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
        uint256 votingPower = getVotingPower(v.commissionShare, validator);
        if (!indexedValidators.contains(v.id) && votingPower >= config.minIndexVotingPower()) {
            indexedValidators.set(v.id, validator);
            emit IndexedValidator(validator, votingPower.sub(msg.value));
        }
        emit Stake(validator, msg.value, to, shares);
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

        // deposit unstake amount to `unstakeManager`
        uint256 unstakeShares = unstakeManager.deposit{ value: amount }(validator);

        // create a `Unstake`
        id = unstakeId;
        uint256 timestamp = block.timestamp + config.unstakeDelay();
        // make sure the timestamp is greater than the last
        if (id > 0) {
            Unstake memory u = unstakeQueue[id.sub(1)];
            if (u.validator != address(0) && u.timestamp > timestamp) {
                timestamp = u.timestamp;
            }
        }
        unstakeQueue[id] = Unstake(validator, to, unstakeShares, timestamp);
        unstakeId = id.add(1);
        emit StartUnstake(id, validator, amount, to, unstakeShares, timestamp);
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
    ) external nonReentrant returns (uint256) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(shares > 0, "StakeManager: invalid shares");
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        CommissionShare(v.commissionShare).transferFrom(msg.sender, address(this), shares);
        uint256 amount = CommissionShare(v.commissionShare).burn(shares);
        if (amount > 0) {
            return _startUnstake(validator, v, to, amount);
        } else {
            return uint256(0) - 1;
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
    function startClaim(address payable to, uint256 amount) external nonReentrant returns (uint256) {
        require(uint160(to) > 2000, "StakeManager: invalid receiver");
        require(amount > 0, "StakeManager: invalid amount");
        Validator memory v = validators[msg.sender];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        validatorRewardManager.claim(msg.sender, amount);
        return _startUnstake(msg.sender, v, to, amount);
    }

    /**
     * @dev Set validator commission rate.
     * @param rate         New commission rate
     */
    function setCommissionRate(uint256 rate) external {
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
    function unstake(uint256 id) external nonReentrant returns (uint256 amount) {
        Unstake memory u = unstakeQueue[id];
        require(u.validator != address(0), "StakeManager: invalid unstake id");
        require(u.timestamp <= block.timestamp, "StakeManager: invalid unstake timestamp");
        amount = unstakeManager.withdraw(u.validator, u.unstakeShares, u.to);
        emit DoUnstake(id, u.validator, u.to, amount);
        delete unstakeQueue[id];
    }

    /**
     * @dev Remove the validator from `indexedValidators` if the voting power is less than `minIndexVotingPower`
     *      This can be called by anyone.
     * @param validator           Validator address
     */
    function removeIndexedValidator(address validator) external {
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
    function addIndexedValidator(address validator) external {
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
    function reward(address validator) external payable onlySystemCaller {
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        uint256 commissionReward = msg.value.mul(v.commissionRate).div(100);
        uint256 validatorReward = msg.value.sub(commissionReward);
        if (commissionReward > 0) {
            CommissionShare(v.commissionShare).reward{ value: commissionReward }();
        }
        if (validatorReward > 0) {
            validatorRewardManager.reward{ value: validatorReward }(validator);
        }
        if (!indexedValidators.contains(v.id)) {
            uint256 votingPower = getVotingPower(v.commissionShare, validator);
            if (votingPower >= config.minIndexVotingPower()) {
                indexedValidators.set(v.id, validator);
                emit IndexedValidator(validator, votingPower.sub(msg.value));
            }
        }
    }

    /**
     * @dev Slash validator, only can be called by system caller
     * @param validator         Validator address
     * @param reason            Slash reason
     */
    function slash(address validator, uint8 reason) external onlySystemCaller returns (uint256 amount) {
        Validator memory v = validators[validator];
        require(v.commissionShare != address(0), "StakeManager: invalid validator");
        uint8 factor = config.getFactorByReason(reason);
        amount = CommissionShare(v.commissionShare).slash(factor).add(unstakeManager.slash(validator, factor)).add(validatorRewardManager.slash(validator, factor));
        if (indexedValidators.contains(v.id) && getVotingPower(v.commissionShare, validator) < config.minIndexVotingPower()) {
            // if the validator's voting power is less than `minIndexVotingPower`, remove him from `_indexedValidators`
            indexedValidators.remove(v.id);
            emit UnindexedValidator(validator);
        }
    }

    /**
     * @dev After block callback, it will be called by system caller after each block is processed
     * @param acValidators       Active validators list
     * @param priorities         Priority list of active validators
     */
    function afterBlock(address[] calldata acValidators, int256[] calldata priorities) external onlySystemCaller {
        require(acValidators.length == priorities.length, "StakeManager: invalid list length");
        uint256 orignLength = activeValidators.length;
        uint256 i = 0;
        for (; i < priorities.length; i = i.add(1)) {
            if (i < orignLength) {
                ActiveValidator storage acValidator = activeValidators[i];
                acValidator.validator = acValidators[i];
                acValidator.priority = priorities[i];
            } else {
                activeValidators.push(ActiveValidator(acValidators[i], priorities[i]));
            }
        }
        for (; i < orignLength; i = i.add(1)) {
            activeValidators.pop();
        }
    }
}
