// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

struct Miner {
    // unique id
    uint256 id;
    // validator jail status
    bool jailed;
    // validator address
    address miner;
    // validator total miss round number
    uint256 missedRoundNumberPeriod;
    // validator latest unjailed block number
    uint256 unjailedBlockNumber;
}

struct MissRecord {
    // miss miner address
    address miner;
    // miss round number per block
    uint256 missedRoundNumberThisBlock;
}

interface IJail {
    function jailed(address _address) external view returns (bool);

    function jail(address _address) external;

    function unjail(address _address) external;
}
