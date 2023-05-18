// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IValidatorBLS.sol";

contract ValidatorBLS is IValidatorBLS {
    // validator BLS public key
    mapping(address => bytes) private validatorBLSPubkey;
    // validators list
    address[] public override validators;
    // BLS public key exist
    mapping(bytes => bool) private _BLSPubkeyExist;

    /**
     * @dev Emitted when validator BLS public key is set.
     * @param validator Validator address.
     * @param BLSPublicKey Validator BLS public key.
     */
    event SetBLSPublicKey(address indexed validator, bytes BLSPublicKey);

    constructor(address[] memory genesisAddrs, bytes[] memory genesisBLSPublicKey) public {
        require(genesisAddrs.length == genesisBLSPublicKey.length, "ValidatorBLS: invalid genesis validators");
        //register genesis validators
        for (uint256 i = 0; i < genesisAddrs.length; i++) {
            validators.push(genesisAddrs[i]);
            validatorBLSPubkey[genesisAddrs[i]] = genesisBLSPublicKey[i];
            _BLSPubkeyExist[genesisBLSPublicKey[i]] = true;
        }
    }

    /**
     * Get validators length.
     * @return length     Validators length.
     */
    function validatorsLength() public view override returns (uint256 length) {
        return validators.length;
    }

    /**
     * Set validator BLS public key.
     * @param key         Validator BLS public key.
     */
    function setBLSPublicKey(bytes memory key) public override {
        require(key.length == 48, "ValidatorBLS: invalid BLS public key");
        require(!_BLSPubkeyExist[key], "ValidatorBLS: BLS public key already exist");
        if (validatorBLSPubkey[msg.sender].length == 0) {
            validators.push(msg.sender);
        } else {
            _BLSPubkeyExist[validatorBLSPubkey[msg.sender]] = false;
        }
        validatorBLSPubkey[msg.sender] = key;
        _BLSPubkeyExist[key] = true;
        emit SetBLSPublicKey(msg.sender, key);
    }

    /**
     * Get validator BLS public key.
     * @param validator         Validator address.
     * @return key              Validator BLS public key.
     */
    function getBLSPublicKey(address validator) public view override returns (bytes memory key) {
        return validatorBLSPubkey[validator];
    }

    /**
     * Check if validator is registered.
     * @param validator         Validator address.
     * @return registered       True if validator is registered.
     */
    function isRegistered(address validator) public view override returns (bool) {
        return validatorBLSPubkey[validator].length > 0;
    }

    /**
     * Check if BLS public key is exist.
     * @param key         Validator BLS public key.
     * @return exist      True if BLS public key is exist.
     */
    function isBLSPublicKeyExist(bytes memory key) public view override returns (bool) {
        return _BLSPubkeyExist[key];
    }
}
