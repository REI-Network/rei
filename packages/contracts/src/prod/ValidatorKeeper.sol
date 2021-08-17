// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "../interfaces/IValidatorKeeper.sol";
import "./Keeper.sol";

///////////////////// only for test /////////////////////
import "@openzeppelin/contracts/math/SafeMath.sol";

contract ValidatorKeeper is Keeper, IValidatorKeeper {
    ///////////////////// only for test /////////////////////
    using SafeMath for uint256;

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

    ///////////////////// only for test /////////////////////

    // reward validator
    function reward() external payable onlyStakeManager {}

    // slash validator
    function slash(uint8 reason) external onlyStakeManager returns (uint256 amount) {
        uint8 factor = config.getFactorByReason(reason);
        amount = address(this).balance.mul(factor).div(100);
        if (amount > 0) {
            msg.sender.transfer(amount);
        }
    }
}
