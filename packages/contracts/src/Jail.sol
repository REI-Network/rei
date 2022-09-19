pragma solidity ^0.8.2;

import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "./interfaces/IJail.sol";

contract Jail is IJail {
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    uint256 public MAX_RECORD_PERIOD = 50;
    uint256 public MISS_LIMIT_NUMBER = 5;

    EnumerableMap.UintToAddressMap private indexMiners;

    mapping(address => Miner) public miners;

    mapping(uint256 => MissRecord[]) public missRecords;

    uint256 public currentBlockNumber;

    function _addMissRecord(uint256 blockNumber, MissRecord[] memory record) private {
        MissRecord[] storage missrecord = missRecords[blockNumber];
        for (uint256 i = 0; i < record.length; i++) {
            missrecord.push(record[i]);
            Miner storage miner = miners[record[i].miner];
            if (miner.miner == address(0)) {
                miner.id = indexMiners.length();
                miner.miner = record[i].miner;
                indexMiners.set(miner.id, miner.miner);
                miner.missedRoundNumberPeriod = record[i].missedRoundNumberThisBlock;
            } else {
                miner.missedRoundNumberPeriod += record[i].missedRoundNumberThisBlock;
            }
        }
    }

    function _deleteTimeOutMissRecord(MissRecord[] memory record) private {
        for (uint256 i = 0; i < record.length; i++) {
            Miner storage miner = miners[record[i].miner];
            if (miner.unjailedBlockNumber > currentBlockNumber - MAX_RECORD_PERIOD) {
                continue;
            } else {
                miner.missedRoundNumberPeriod -= record[i].missedRoundNumberThisBlock;
            }
        }
    }

    function addMissRecord(MissRecord[] memory record) public {
        uint256 blockNumber = block.number;
        if (blockNumber > MAX_RECORD_PERIOD) {
            _deleteTimeOutMissRecord(missRecords[blockNumber - MAX_RECORD_PERIOD]);
            delete missRecords[blockNumber - MAX_RECORD_PERIOD];
        }
        _addMissRecord(blockNumber, record);
    }

    function addMissRecordTest(MissRecord[] memory record, uint256 blockNumer) public {
        if (blockNumber > MAX_RECORD_PERIOD) {
            _deleteTimeOutMissRecord(missRecords[blockNumber - MAX_RECORD_PERIOD]);
            delete missRecords[blockNumber - MAX_RECORD_PERIOD];
        }
        _addMissRecord(blockNumber, record);
    }

    function addMissRecordTestBatch(
        uint256 startNumber,
        uint256 batchNumber,
        uint256 forgeNumber
    ) public {
        for (uint256 i = 1; i <= batchNumber; i++) {
            addMissRecordTest(forgeRecord(forgeNumber), startNumber + i);
            startNumber++;
        }
        currentBlockNumber = startNumber;
    }

    function forgeRecord(uint256 pattern) private returns (MissRecord[] memory) {
        MissRecord[] memory record0;
        MissRecord[] memory record1 = new MissRecord[](1);
        record1[0] = MissRecord(msg.sender, uint256(1));
        MissRecord[] memory record2 = new MissRecord[](1);
        address another = 0x0000000000000000000000000000000000000000;
        record2[0] = MissRecord(another, uint256(1));
        if (pattern == uint256(0)) {
            return record0;
        } else if (pattern == uint256(1)) {
            return record1;
        } else if (pattern == uint256(2)) {
            return record2;
        } else {
            revert("invalid pattern");
        }
    }

    function _jail(address _address) private {
        Miner storage miner = miners[_address];
        require(miner.miner != address(0), "Jail: miner is not exist");
        miner.jailed = true;
        miner.missedRoundNumberPeriod = 0;
    }

    function _unjail(address _address) private {
        Miner storage miner = miners[_address];
        require(miner.miner != address(0), "Jail: miner is not exist");
        miner.jailed = false;
        miner.unjailedBlockNumber = block.number;
    }

    function pickMinersLength() public view returns (uint256) {
        return indexMiners.length();
    }

    function getMinerByIndex(uint256 index) public view returns (address) {
        return indexMiners.get(index);
    }

    function getMinerStateByIndex(uint256 index) public view returns (Miner memory) {
        return miners[indexMiners.get(index)];
    }

    function getMinerStateByAddress(address _address) public view returns (Miner memory) {
        return miners[_address];
    }

    function verifyByAddress(address _address, uint256 missNumber) public returns (bool) {
        Miner storage miner = miners[_address];
        require(miner.miner != address(0), "Jail: miner is not exist");
        return miner.missedRoundNumberPeriod >= missNumber;
    }
}
