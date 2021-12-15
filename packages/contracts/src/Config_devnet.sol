// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./DevConfig.sol";

/**
 * Config contract for devnet
 */
contract Config_devnet is DevConfig {
    constructor() public {
        // this is the default account in hardhat,
        // you can replace it with your own address,
        // privateKey: ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
        transferOwnership(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266);
    }
}
