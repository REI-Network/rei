// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IContractFee.sol";
import "./libraries/Util.sol";

contract ContractFee is IContractFee {
    // a mapping that records all contract fee settings
    mapping(address => uint256) public override feeOf;
    // a mapping that records each contract creator
    mapping(address => address) public override creatorOf;

    /**
     * @dev Registration event, emit when someone registers their contract.
     * @param parent        Creator
     * @param child         Contract address
     */
    event Register(address parent, address child);

    // calculate the byte size of an unsigned integer
    // exmaple:
    //      [0, 255]      - 1
    //      [256 - 65535] - 2
    //      ...
    function bytesSize(uint256 i) private pure returns (uint8 size) {
        size = 1;
        uint256 threshold = 0x100;
        while (i > threshold - 1) {
            threshold = threshold << 8;
            size++;
        }
    }

    // convert uint256 to bytes based byte size
    function toBytes(uint256 x, uint8 a) private pure returns (bytes memory b) {
        b = new bytes(a);
        for (uint256 i = 0; i < a; i++) {
            b[i] = bytes1(uint8(x / (2**(8 * (a - 1 - i)))));
        }
    }

    // simple rlp encoding logic, only prepared for [address, nonce]
    function rlpEncode(address from, uint256 nonce) private pure returns (bytes memory) {
        // if the nonce is less than 0x7f, the rlp encodeing of the nonce will be itself
        if (nonce <= 0x7f) {
            if (nonce == 0) {
                // if the nonce is zero, it should be `null`
                return abi.encodePacked(hex"d694", from, hex"80");
            } else {
                return abi.encodePacked(hex"d694", from, bytes1(uint8(nonce)));
            }
        } else {
            // calculate byte size of nonce
            uint8 size = bytesSize(nonce);
            /**
             * @dev https://eth.wiki/fundamentals/rlp
             *
             *      Rlp encoding result will be:
             *      (0xC0 + listSize) + (0x80 + addressSize) + address + (0x80 + nonceSize) + nonce
             *
             *          0xC0: list prefix
             *          listSize: the size of list, listSize = addressSize + nonceSize + 2,
             *                its maximum value is 55
             *          0x80: bytes prefix, bytes' maximum value is 55
             *          addressSize: the size of address, it is 20
             *          nonceSize: the size of nonce, its maximum value is 32
             *
             *      The maximum available value of listSize is 55 - 20 - 2 = 33,
             *      And the maximum value of nonceSize is 32,
             *      So, it will never overflow
             *
             *      notice:
             *          0xD6 = 0xC0 + 0d20 + 0d2
             *          0x94 = 0x80 + 0d20
             */
            return abi.encodePacked(bytes1(0xd6 + size), hex"94", from, bytes1(0x80 + size), toBytes(nonce, size));
        }
    }

    /**
     * @dev Generate contract address.
     * @param from          Creator address
     * @param nonce         Creator nonce
     */
    function generateAddress(address from, uint256 nonce) public pure override returns (address) {
        return address(uint256(keccak256(rlpEncode(from, nonce))));
    }

    /**
     * @dev Generate contract address(create2).
     * @param from          Creator address
     * @param salt          Salt
     * @param codeHash      Deploy code hash, notice: this is not the same as the account code hash
     */
    function generateAddress2(
        address from,
        bytes32 salt,
        bytes32 codeHash
    ) public pure override returns (address) {
        return address(uint256(keccak256(abi.encodePacked(hex"ff", from, salt, codeHash))));
    }

    // generate contract address and ensure that the contract exists
    function _create(address from, uint256 nonce) private view returns (address contractAddress) {
        contractAddress = generateAddress(from, nonce);
        require(Util.isContract(contractAddress), "ContractFee: creation contract does not exist");
    }

    // generate contract address and ensure that the contract exists(create2)
    function _create2(
        address from,
        bytes32 salt,
        bytes32 deployCodeHash
    ) private view returns (address contractAddress) {
        contractAddress = generateAddress2(from, salt, deployCodeHash);
        require(Util.isContract(contractAddress), "ContractFee: creation contract does not exist");
    }

    // try to register the contract creator,
    // if the creator already exists, make sure that the creator is the same as the parent,
    // if it doesn't exist, add it to the map and emit an event
    function _register(address parent, address child) private returns (address) {
        address _parent = creatorOf[child];
        if (_parent == address(0)) {
            creatorOf[child] = parent;
            emit Register(parent, child);
        } else {
            require(_parent == parent, "ContractFee: invalid parent");
        }
        return child;
    }

    /**
     * @dev Register the contract creator.
     * @param parent        Root creator address
     * @param flags         A list of flags,
     *                      if the flag is true, it means `create` and load a nonce from nonces,
     *                      otherwise it means `create2` and load a `Create2Info` from infos
     * @param nonces        A list of nonces
     * @param infos         A list of `Create2Info`
     */
    function register(
        address parent,
        bool[] calldata flags,
        uint256[] calldata nonces,
        Create2Info[] calldata infos
    ) external override {
        require(flags.length > 0 && flags.length == nonces.length + infos.length, "ContractFee: invalid input");
        uint256 index1 = 0;
        uint256 index2 = 0;
        for (uint256 i = 0; i < flags.length; i++) {
            if (flags[i]) {
                require(index1 < nonces.length, "ContractFee: out of index");
                parent = _register(parent, _create(parent, nonces[index1++]));
            } else {
                require(index2 < infos.length, "ContractFee: out of index");
                Create2Info memory c2i = infos[index2++];
                parent = _register(parent, _create2(parent, c2i.salt, c2i.deployCodeHash));
            }
        }
    }

    /**
     * @dev Set contract fee.
     *      The contract fee can be set only when the sender is the creator of the contract.
     * @param contractAddress       Target contract address
     * @param fee                   Contract fee
     */
    function setFee(address contractAddress, uint256 fee) external override {
        // this will cause some problems, when delegate call
        // if (contractAddress == msg.sender) {
        //     require(Util.isContract(contractAddress), "ContractFee: invalid sender");
        // }
        address creator = creatorOf[contractAddress];
        while (creator != address(0) && creator != msg.sender) {
            creator = creatorOf[creator];
        }
        require(creator != address(0), "ContractFee: invalid sender");
        feeOf[contractAddress] = fee;
    }
}
