// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "../interfaces/IContractFee.sol";
import "../interfaces/IConfig.sol";

contract Product {
    IConfig public config;

    constructor() public {}

    function init(IConfig _config) external {
        config = _config;
    }

    function exists() external pure returns (bool) {}

    function setFee(uint256 fee) external {
        IContractFee(config.contractFee()).setFee(address(this), fee);
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
        product.init(config);
        emit NewProduct(address(product));
    }

    function produce2(bytes32 salt) external {
        address product;
        bytes memory bytecode = type(Product).creationCode;
        assembly {
            product := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        Product(product).init(config);
        emit NewProduct(product);
    }

    function productBytecode() external pure returns (bytes memory bytecode) {
        bytecode = type(Product).creationCode;
    }

    function setFeeFor(address contractAddress, uint256 fee) external {
        IContractFee(config.contractFee()).setFee(contractAddress, fee);
    }
}
