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

    address[] public override jailedMiners;

    // miner mapping, including all validators
    mapping(address => Miner) public override miners;
    // missrecord mapping, indexed by block number
    mapping(uint256 => MissRecord[]) public override missRecords;

    // lowest miss record blocknumber
    uint256 public override lowestRecordBlockNumber;

    event Unjail(address indexed miner, uint256 indexed blockNumber, uint256 forfeit);

    constructor(IConfig _config) public Only(_config) {}

    function addMissRecord(MissRecord[] calldata record) external override onlyStakeManager returns (address[] memory) {
        // delete timeout miss record
        uint256 blockNumberNow = block.number;
        if (blockNumberNow >= config.recordsAmountPeriod()) {
            uint256 blockNumberToDelete = blockNumberNow.sub(config.recordsAmountPeriod());
            for (uint256 i = lowestRecordBlockNumber; i <= blockNumberToDelete; i = i.add(1)) {
                MissRecord[] storage missRecord = missRecords[i];
                for (uint256 j = 0; j < missRecord.length; j = j.add(1)) {
                    Miner storage miner = miners[missRecord[j].miner];
                    if (miner.unjailedBlockNumber > i || miner.jailed) {
                        continue;
                    } else {
                        miner.missedRoundNumberPeriod = miner.missedRoundNumberPeriod.sub(missRecord[j].missedRoundNumberThisBlock);
                    }
                }
                for (uint256 j = 0; j < missRecord.length; j = j.add(1)) {
                    missRecord.pop();
                }
                delete missRecords[i];
            }
            lowestRecordBlockNumber = blockNumberToDelete.add(1);
        }

        // empty jailedMiners
        for (uint256 i = 0; i < jailedMiners.length; i = i.add(1)) {
            jailedMiners.pop();
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
                miner.miner = missRecord.miner;
                miner.missedRoundNumberPeriod = missRecord.missedRoundNumberThisBlock;
            } else {
                miner.missedRoundNumberPeriod = miner.missedRoundNumberPeriod.add(missRecord.missedRoundNumberThisBlock);
                if (miner.missedRoundNumberPeriod >= config.jailThreshold() && !miner.jailed) {
                    _jail(miner.miner);
                    jailedMiners.push(miner.miner);
                }
            }
        }
        return jailedMiners;
    }

    function _jail(address _address) private {
        Miner storage miner = miners[_address];
        require(!miner.jailed && miner.miner != address(0), "Jail: miner is jailed or not exist");
        miner.jailed = true;
        miner.missedRoundNumberPeriod = 0;
    }

    function unjail() external payable override onlyStakeManager {
        require(msg.value >= config.forfeit(), "Unjail: the forfeit you have to pay is not enough");
        Miner storage miner = miners[tx.origin];
        require((miner.jailed) && miner.miner != address(0), "Jail: miner is not jailed or not exist");
        miner.jailed = false;
        miner.unjailedBlockNumber = block.number;
        emit Unjail(tx.origin, block.number, msg.value);
    }

    function getMissRecordsLengthByBlcokNumber(uint256 blockNumber) external view override returns (uint256) {
        return missRecords[blockNumber].length;
    }
}
