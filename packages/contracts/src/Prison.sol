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

    event Unjail(address indexed miner, uint256 indexed blockNumber, uint256 forfeit);

    constructor(IConfig _config) public Only(_config) {}

    function addMissRecord(MissRecord[] calldata record) external override onlySystemCaller {
        uint256 blockNumberNow = block.number;
        if (blockNumberNow >= config.recordsAmountPeriod()) {
            uint256 blockNumberToDelete = blockNumberNow - config.recordsAmountPeriod();
            for (uint256 i = lowestRecordBlockNumber; i <= blockNumberToDelete; i++) {
                MissRecord[] memory missRecord = missRecords[i];
                for (uint256 j = 0; j < missRecord.length; j++) {
                    Miner storage miner = miners[missRecord[j].miner];
                    if (miner.unjailedBlockNumber > i || miner.jailed) {
                        continue;
                    } else {
                        miner.missedRoundNumberPeriod -= missRecord[j].missedRoundNumberThisBlock;
                    }
                }
                delete missRecords[i];
            }
            lowestRecordBlockNumber = blockNumberToDelete + 1;
        }
        MissRecord[] storage recordToAdd = missRecords[blockNumberNow];
        for (uint256 k = 0; k < record.length; k++) {
            MissRecord memory missRecord = record[k];
            recordToAdd.push(missRecord);
            Miner storage miner = miners[record[k].miner];
            if (miner.jailed) {
                continue;
            }
            if (miner.miner == address(0)) {
                miner.miner = record[k].miner;
                indexMiners.set(indexMiners.length(), miner.miner);
                miner.missedRoundNumberPeriod = record[k].missedRoundNumberThisBlock;
            } else {
                miner.missedRoundNumberPeriod += record[k].missedRoundNumberThisBlock;
            }
        }
    }

    function jail(address _address) external override onlySystemCaller {
        Miner storage miner = miners[_address];
        require(!(miner.jailed) && miner.miner != address(0), "Jail: miner is jailed or not exist");
        miner.jailed = true;
        miner.missedRoundNumberPeriod = 0;
    }

    function unjail() external payable override {
        require(msg.value >= config.forfeit(), "Unjail: the forfeit you have to pay is not enough");
        Miner storage miner = miners[msg.sender];
        require((miner.jailed) && miner.miner != address(0), "Jail: miner is not jailed or not exist");
        miner.jailed = false;
        miner.unjailedBlockNumber = block.number;
        emit Unjail(msg.sender, block.number, msg.value);
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

    function getMissRecordsLengthByBlcokNumber(uint256 blockNumber) external view override returns (uint256) {
        return missRecords[blockNumber].length;
    }

    receive() external payable {}
}
