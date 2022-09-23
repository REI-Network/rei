// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IPrison.sol";
import "./Only.sol";

contract Prison is ReentrancyGuard, Only, IPrison {
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    uint256 public override recordsAmountPeriod = 100;

    EnumerableMap.UintToAddressMap private indexMiners;

    mapping(address => Miner) public override miners;

    mapping(uint256 => MissRecord[]) public override missRecords;

    uint256 public override lowestRecordBlockNumber;

    event Jail(address indexed miner, uint256 indexed blockNumber);

    event Unjail(address indexed miner, uint256 indexed blockNumber);

    event AddMissRecord(uint256 indexed blockNumber, MissRecord[] indexed missRecords);

    event ResetRecordsAmountPeriod(uint256 indexed recordsAmountPeriod, uint256 indexed blockNumber);

    constructor(IConfig _config) public Only(_config) {}

    function _addMissRecord(uint256 blockNumber, MissRecord[] memory record) private {
        MissRecord[] storage missrecord = missRecords[blockNumber];
        for (uint256 i = 0; i < record.length; i++) {
            missrecord.push(record[i]);
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
        MissRecord[] memory missrecord = missRecords[blockNumberToDelete];
        for (uint256 i = 0; i < missrecord.length; i++) {
            Miner storage miner = miners[missrecord[i].miner];
            if (miner.unjailedBlockNumber > blockNumberToDelete || miner.jailed) {
                continue;
            } else {
                miner.missedRoundNumberPeriod -= missrecord[i].missedRoundNumberThisBlock;
            }
        }
    }

    function addMissRecord(MissRecord[] calldata record) external override nonReentrant onlySystemCaller {
        uint256 blockNumberNow = block.number;
        if (blockNumberNow >= recordsAmountPeriod) {
            uint256 blockNumberToDelete = blockNumberNow - recordsAmountPeriod;
            if (lowestRecordBlockNumber <= blockNumberToDelete) {
                for (uint256 i = lowestRecordBlockNumber; i <= blockNumberToDelete; i++) {
                    _deleteTimeOutMissRecord(i);
                    delete missRecords[i];
                }
            }
            lowestRecordBlockNumber = blockNumberToDelete + 1;
        }
        _addMissRecord(blockNumberNow, record);
        emit AddMissRecord(blockNumberNow, record);
    }

    function _jail(address _address) private {
        Miner storage miner = miners[_address];
        require(miner.miner != address(0), "Jail: miner is not exist");
        miner.jailed = true;
        miner.missedRoundNumberPeriod = 0;
    }

    function jail(address _address) external override nonReentrant onlySystemCaller {
        _jail(_address);
        emit Jail(_address, block.number);
    }

    function _unjail(address _address) private {
        require(miners[_address].jailed, "Jail: miner is not jailed");
        Miner storage miner = miners[_address];
        require(miner.miner != address(0), "Jail: miner is not exist");
        miner.jailed = false;
        miner.unjailedBlockNumber = block.number;
    }

    function unjail() external override nonReentrant {
        _unjail(msg.sender);
        emit Unjail(msg.sender, block.number);
    }

    function resetRecordsAmountPeriod(uint256 _recordsAmountPeriod) external override nonReentrant onlySystemCaller {
        recordsAmountPeriod = _recordsAmountPeriod;
        emit ResetRecordsAmountPeriod(_recordsAmountPeriod, block.number);
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

    function getMissedRoundNumberPeriodByIndex(uint256 index) external view override returns (uint256) {
        Miner memory miner = miners[indexMiners.get(index)];
        return miner.missedRoundNumberPeriod;
    }
}
