// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IPrison.sol";
import "./Only.sol";

contract Prison is Only, IPrison {
    using EnumerableMap for EnumerableMap.UintToAddressMap;
    using SafeMath for uint256;

    // auto increment miner id
    uint256 public override minerId = 0;
    // indexed miners, including all jailed miners
    EnumerableMap.UintToAddressMap private indexedJailedMiners;
    // miner mapping, including all miners
    mapping(address => Miner) public override miners;
    // missrecord mapping, indexed by block number
    mapping(uint256 => MissRecord[]) public override missRecords;
    // jail record mapping, indexed by block number
    mapping(uint256 => address[]) public override jailedRecords;
    // lowest miss record blocknumber
    uint256 public override lowestRecordBlockNumber;

    /**
     * Emitted when a miner unjailed from prison
     * @param miner         address of miner
     * @param blockNumber   block number of unjailed
     * @param forfeit       Amount of forfeit
     */
    event Unjail(address indexed miner, uint256 indexed blockNumber, uint256 forfeit);

    constructor(IConfig _config) public Only(_config) {}

    /**
     * Add miss record into the contract, called by onlyStakeManager every block
     * @param record        MissRecord data
     */
    function addMissRecord(MissRecord[] calldata record) external override onlyStakeManager returns (address[] memory) {
        if (block.number < 1) {
            return new address[](0);
        }
        // delete timeout miss record
        uint256 blockNumberNow = block.number - 1;
        if (blockNumberNow >= config.recordsAmountPeriod()) {
            uint256 blockNumberToDelete = blockNumberNow.sub(config.recordsAmountPeriod());
            for (uint256 i = lowestRecordBlockNumber; i <= blockNumberToDelete; i = i.add(1)) {
                MissRecord[] storage missRecord = missRecords[i];
                if (missRecord.length != 0) {
                    for (uint256 j = missRecord.length.sub(1); j >= 0; ) {
                        Miner storage miner = miners[missRecord[j].miner];
                        if (miner.lastUnjailedBlockNumber <= i && !miner.jailed) {
                            miner.missedRoundNumberPeriod = miner.missedRoundNumberPeriod.sub(missRecord[j].missedRoundNumberThisBlock);
                        }
                        missRecord.pop();
                        if (j == 0) {
                            break;
                        } else {
                            j = j.sub(1);
                        }
                    }
                }
                delete missRecords[i];
            }
            lowestRecordBlockNumber = blockNumberToDelete.add(1);
        }

        // add new miss record
        address[] storage jailedMiner = jailedRecords[blockNumberNow];
        MissRecord[] storage recordToAdd = missRecords[blockNumberNow];
        for (uint256 i = 0; i < record.length; i = i.add(1)) {
            MissRecord memory missRecord = record[i];
            recordToAdd.push(missRecord);
            Miner storage miner = miners[missRecord.miner];
            if (miner.jailed) {
                continue;
            }
            if (miner.miner == address(0)) {
                miner.id = minerId;
                miner.miner = missRecord.miner;
                miner.missedRoundNumberPeriod = missRecord.missedRoundNumberThisBlock;
                minerId = minerId.add(1);
            } else {
                miner.missedRoundNumberPeriod = miner.missedRoundNumberPeriod.add(missRecord.missedRoundNumberThisBlock);
            }
            if (miner.missedRoundNumberPeriod >= config.jailThreshold() && !miner.jailed) {
                miner.jailed = true;
                miner.missedRoundNumberPeriod = 0;
                miner.lastJailedBlockNumber = block.number;
                indexedJailedMiners.set(miner.id, miner.miner);
                jailedMiner.push(miner.miner);
            }
        }
        return jailedMiner;
    }

    /**
     * Unjail the miner
     * @param minerAddress      address of miner
     */
    function unjail(address minerAddress) external payable override onlyStakeManager {
        require(msg.value >= config.forfeit(), "Unjail: the forfeit you have to pay is not enough");
        Miner storage miner = miners[minerAddress];
        require(miner.jailed && miner.miner != address(0), "Jail: miner is not jailed or not exist");
        miner.jailed = false;
        miner.lastUnjailedBlockNumber = block.number;
        indexedJailedMiners.remove(miner.id);
        emit Unjail(minerAddress, block.number, msg.value);
    }

    /**
     * Get the missRecord length by blockNumber
     * @param blockNumber       block number
     */
    function getMissRecordsLengthByBlockNumber(uint256 blockNumber) external view override returns (uint256) {
        return missRecords[blockNumber].length;
    }

    /**
     * Get the jaiedRecord lenth by blockNumber
     * @param blockNumber       block number
     */
    function getJaiedMinersLengthByBlockNumber(uint256 blockNumber) external view override returns (uint256) {
        return jailedRecords[blockNumber].length;
    }

    /**
     * Get jailed Miners length
     */
    function getJailedMinersLength() external view override returns (uint256) {
        return indexedJailedMiners.length();
    }

    /**
     * Get jailed miner by index
     * @param index     index of jailed miner
     */
    function getJailedMinersByIndex(uint256 index) external view override returns (address miner) {
        (, miner) = indexedJailedMiners.at(index);
    }

    /**
     * Get jailed miner by id
     * @param id        id of jailed miner
     */
    function getJailedMinersById(uint256 id) external view override returns (address) {
        return indexedJailedMiners.get(id);
    }
}
