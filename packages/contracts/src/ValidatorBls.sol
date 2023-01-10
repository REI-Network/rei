pragma solidity ^0.6.0;

import "./Only.sol";
import "./interfaces/IValidatorBls.sol";

contract ValidatorBls is Only, IValidatorBls {
    //validator bls public key
    mapping(address => bytes) private validatorBlsPubkey;
    // validators list
    address[] public override validators;

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
    function getValidatorsLength() public view override returns (uint256 length) {
        return validators.length;
    }

    /**
     * Set validator bls public key.
     * @param key         Validator Bls public key.
     */
    function setBlsPublicKey(bytes memory key) public override {
        require(key.length == 48, "BLS public key must be 48 bytes");
        if (validatorBlsPubkey[msg.sender].length == 0) validators.push(msg.sender);
        validatorBlsPubkey[msg.sender] = key;
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
}
