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

    // auto increment validator id
    uint256 public override minerId = 0;
    // indexed miners, including all jailed miners
    EnumerableMap.UintToAddressMap private indexedJailedMiners;
    // miner mapping, including all validators
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
    function addMissRecord(MissRecord[] calldata record) external override onlyStakeManager {
        // delete timeout miss record
        uint256 blockNumberNow = block.number;
        if (blockNumberNow >= config.recordsAmountPeriod()) {
            uint256 blockNumberToDelete = blockNumberNow.sub(config.recordsAmountPeriod());
            for (uint256 i = lowestRecordBlockNumber; i <= blockNumberToDelete; i = i.add(1)) {
                MissRecord[] storage missRecord = missRecords[i];
                if (missRecord.length != 0) {
                    for (uint256 j = missRecord.length; j > 0; j = j.sub(1)) {
                        Miner storage miner = miners[missRecord[j.sub(1)].miner];
                        if (miner.unjailedBlockNumber > i || miner.jailed) {
                            continue;
                        } else {
                            miner.missedRoundNumberPeriod = miner.missedRoundNumberPeriod.sub(missRecord[j.sub(1)].missedRoundNumberThisBlock);
                        }
                        missRecord.pop();
                    }
                }
                delete missRecords[i];
            }
            lowestRecordBlockNumber = blockNumberToDelete.add(1);
        }

        // add new miss record
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
                indexedJailedMiners.set(miner.id, miner.miner);
                address[] storage jailedMiner = jailedRecords[blockNumberNow];
                jailedMiner.push(miner.miner);
            }
        }
    }

    /**
     * Unjail the miner
     * @param minerAddress      address of miner
     */
    function unjail(address minerAddress) external payable override onlyStakeManager {
        require(msg.value >= config.forfeit(), "Unjail: the forfeit you have to pay is not enough");
        Miner storage miner = miners[minerAddress];
        require((miner.jailed) && miner.miner != address(0), "Jail: miner is not jailed or not exist");
        miner.jailed = false;
        miner.unjailedBlockNumber = block.number;
        indexedJailedMiners.remove(miner.id);
        emit Unjail(minerAddress, block.number, msg.value);
    }

    /**
     * Get the missRecord length by blockNumber
     * @param blockNumber       block number
     */
    function getMissRecordsLengthByBlcokNumber(uint256 blockNumber) external view override returns (uint256) {
        return missRecords[blockNumber].length;
    }

    function getJaiedMinersLengthByBlcokNumber(uint256 blockNumber) external view override returns (uint256) {
        return jailedRecords[blockNumber].length;
    }

    function getJailedMinersLength() external view override returns (uint256) {
        return indexedJailedMiners.length();
    }
}
