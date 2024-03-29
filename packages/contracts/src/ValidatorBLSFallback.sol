// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

contract ValidatorBLSFallback {
    fallback() external {
        revert("ValidatorBLS: the BLS public key registration contract has been switched");
    }
}
