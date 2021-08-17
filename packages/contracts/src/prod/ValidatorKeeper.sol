// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "../interfaces/IValidatorKeeper.sol";
import "./Keeper.sol";

contract ValidatorKeeper is Keeper, IValidatorKeeper {
    constructor(address _config, address validator) public Keeper(_config, validator) {}

    /**
     * @dev Claim amount
     * @param amount    Claim amount
     * @param to        Receiver address
     */
    function claim(uint256 amount, address payable to) external override onlyStakeManager {
        require(address(this).balance >= amount, "Keeper: insufficient balance");
        to.transfer(amount);
    }
}
