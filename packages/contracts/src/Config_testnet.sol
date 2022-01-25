// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./DevConfig.sol";

/**
 * Config contract for devnet
 */
contract Config_testnet is DevConfig {
    constructor() public {
        ud = 7 days;
        wd = 3 days;
        mivp = 100e18; // 100 REI
        scri = 1 days;
        fpi = 1 days;

        // one of testnet genesis validators
        transferOwnership(0x4779Af7e65c055979C8100f2183635E5d28c78f5);
    }
}
