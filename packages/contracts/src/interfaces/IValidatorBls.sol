// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

interface IValidatorBls {
    function validators(uint256) external view returns (address);

    function validatorsLength() external view returns (uint256);

    function setBlsPublicKey(bytes calldata key) external;

    function getBlsPublicKey(address) external view returns (bytes memory);

    function isRegistered(address) external view returns (bool);

    function blsPublicKeyExist(bytes calldata) external view returns (bool);
}
