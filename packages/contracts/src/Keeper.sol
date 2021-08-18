// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IConfig.sol";
import "./interfaces/IKeeper.sol";
import "./Variable.sol";

abstract contract Keeper is Variable, IKeeper {
    address private _validator;

    constructor(address config, address validator) public Variable(config) {
        _validator = validator;
    }

    /**
     * @dev Get validator address
     */
    function validator() external view override returns (address) {
        return _validator;
    }
}
