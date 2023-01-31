pragma solidity ^0.6.0;

import "./Only.sol";
import "./interfaces/IValidatorBls.sol";

contract ValidatorBls is Only, IValidatorBls {
    //validator bls public key
    mapping(address => bytes) private validatorBlsPubkey;
    // validators list
    address[] public override validators;
    // bls public key exist
    mapping(bytes => bool) private _blsPubkeyExist;

    /**
     * @dev Emitted when validator bls public key is set.
     * @param validator Validator address.
     * @param blsPubicKey Validator bls public key.
     */
    event SetBlsPublicKey(address indexed validator, bytes blsPubicKey);

    constructor(IConfig _config) public Only(_config) {}

    /**
     * Get validators length.
     * @return length     Validators length.
     */
    function validatorsLength() public view override returns (uint256 length) {
        return validators.length;
    }

    /**
     * Set validator bls public key.
     * @param key         Validator Bls public key.
     */
    function setBlsPublicKey(bytes memory key) public override {
        require(key.length == 48, "ValidatorBls: invalid bls public key");
        require(!_blsPubkeyExist[key], "ValidatorBls: bls public key already exist");
        if (validatorBlsPubkey[msg.sender].length == 0) validators.push(msg.sender);
        validatorBlsPubkey[msg.sender] = key;
        _blsPubkeyExist[key] = true;
        emit SetBlsPublicKey(msg.sender, key);
    }

    /**
     * Get validator bls public key.
     * @param validator         Validator address.
     * @return key              Validator bls public key.
     */
    function getBlsPublicKey(address validator) public view override returns (bytes memory key) {
        return validatorBlsPubkey[validator];
    }

    /**
     * Check if validator is registered.
     * @param validator         Validator address.
     * @return registered       True if validator is registered.
     */
    function isRegistered(address validator) public view override returns (bool) {
        return validatorBlsPubkey[validator].length > 0;
    }

    /**
     * Check if bls public key is exist.
     * @param key         Validator bls public key.
     * @return exist      True if bls public key is exist.
     */
    function blsPublicKeyExist(bytes memory key) public view override returns (bool) {
        return _blsPubkeyExist[key];
    }
}
