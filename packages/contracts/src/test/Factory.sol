// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

interface IConfig {
    function contractFee() external view returns (address);
}

interface IContractFee {
    function setFee(address, uint256) external;
}

contract Product {
    function exists() external pure returns (bool) {
        return true;
    }
}

contract Factory {
    IConfig public config;

    event NewProduct(address indexed product);

    constructor(IConfig _config) public {
        config = _config;
    }

    function produce() external {
        Product product = new Product();
        emit NewProduct(address(product));
    }

    function produce2(bytes32 salt) external {
        address product;
        bytes memory bytecode = type(Product).creationCode;
        assembly {
            product := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        emit NewProduct(product);
    }

    function productBytecode() external pure returns (bytes memory bytecode) {
        bytecode = type(Product).creationCode;
    }

    function setFeeFor(address contractAddress, uint256 fee) external {
        IContractFee(config.contractFee()).setFee(contractAddress, fee);
    }
}
