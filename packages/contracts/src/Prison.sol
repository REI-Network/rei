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

    // indexed miners, including all miners with miss record
    EnumerableMap.UintToAddressMap private indexMiners;
    // miner mapping, including all validators
    mapping(address => Miner) public override miners;
    // missrecord mapping, indexed by block number
    mapping(uint256 => MissRecord[]) public override missRecords;

    // lowest miss record blocknumber
    uint256 public override lowestRecordBlockNumber;

    event Unjail(address indexed miner, uint256 indexed blockNumber);

    constructor(IConfig _config) public Only(_config) {}

    function _addMissRecord(uint256 blockNumber, MissRecord[] memory record) private {
        MissRecord[] storage missRecord = missRecords[blockNumber];
        for (uint256 i = 0; i < record.length; i++) {
            missRecord.push(record[i]);
            Miner storage miner = miners[record[i].miner];
            if (miner.jailed) {
                continue;
            }
            if (miner.miner == address(0)) {
                miner.miner = record[i].miner;
                indexMiners.set(indexMiners.length(), miner.miner);
                miner.missedRoundNumberPeriod = record[i].missedRoundNumberThisBlock;
            } else {
                miner.missedRoundNumberPeriod += record[i].missedRoundNumberThisBlock;
            }
        }
    }

    function _deleteTimeOutMissRecord(uint256 blockNumberToDelete) private {
        MissRecord[] memory missRecord = missRecords[blockNumberToDelete];
        for (uint256 i = 0; i < missRecord.length; i++) {
            Miner storage miner = miners[missRecord[i].miner];
            if (miner.unjailedBlockNumber > blockNumberToDelete || miner.jailed) {
                continue;
            } else {
                miner.missedRoundNumberPeriod -= missRecord[i].missedRoundNumberThisBlock;
            }
        }
    }

    function addMissRecord(MissRecord[] calldata record) external override onlySystemCaller {
        uint256 blockNumberNow = block.number;
        if (blockNumberNow >= config.recordsAmountPeriod()) {
            uint256 blockNumberToDelete = blockNumberNow - config.recordsAmountPeriod();
            for (uint256 i = lowestRecordBlockNumber; i <= blockNumberToDelete; i++) {
                _deleteTimeOutMissRecord(i);
                delete missRecords[i];
            }
            lowestRecordBlockNumber = blockNumberToDelete + 1;
        }
        _addMissRecord(blockNumberNow, record);
    }

    function jail(address _address) external override onlySystemCaller {
        Miner storage miner = miners[_address];
        require(!(miner.jailed) && miner.miner != address(0), "Jail: miner is jailed or not exist");
        miner.jailed = true;
        miner.missedRoundNumberPeriod = 0;
    }

    function unjail() external override {
        Miner storage miner = miners[msg.sender];
        require(!(miner.jailed) && miner.miner != address(0), "Jail: miner is jailed or not exist");
        miner.jailed = true;
        miner.missedRoundNumberPeriod = 0;
        emit Unjail(msg.sender, block.number);
    }

    function getMinersLength() external view override returns (uint256) {
        return indexMiners.length();
    }

    function getMinerAddressByIndex(uint256 index) external view override returns (address) {
        return indexMiners.get(index);
    }

    function getMinerByIndex(uint256 index) external view override returns (Miner memory) {
        return miners[indexMiners.get(index)];
    }
}
