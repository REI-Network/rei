// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IContractFee.sol";
import "./libraries/Util.sol";

contract ContractFee is IContractFee {
    mapping(address => uint256) public override feeOf;
    mapping(address => address) public override creatorOf;

    event Register(address parent, address child);

    function bytesSize(uint256 i) private pure returns (uint8 size) {
        size = 1;
        uint256 threshold = 0x100;
        while (i > threshold - 1) {
            threshold = threshold << 8;
            size++;
        }
    }

    function toBytes(uint256 x, uint8 a) private pure returns (bytes memory b) {
        b = new bytes(a);
        for (uint256 i = 0; i < a; i++) {
            b[i] = bytes1(uint8(x / (2**(8 * (a - 1 - i)))));
        }
    }

    function rlpEncode(address from, uint256 nonce) private pure returns (bytes memory) {
        if (nonce <= 0x7f) {
            if (nonce == 0) {
                return abi.encodePacked(hex"d694", from, hex"80");
            } else {
                return abi.encodePacked(hex"d694", from, bytes1(uint8(nonce)));
            }
        } else {
            uint8 size = bytesSize(nonce);
            return abi.encodePacked(bytes1(0xd6 + size), hex"94", from, bytes1(0x80 + size), toBytes(nonce, size));
        }
    }

    function generateAddress(address from, uint256 nonce) public pure returns (address) {
        return address(uint256(keccak256(rlpEncode(from, nonce))));
    }

    function generateAddress2(
        address from,
        bytes32 salt,
        bytes32 codeHash
    ) public pure returns (address) {
        return address(uint256(keccak256(abi.encodePacked(hex"ff", from, salt, codeHash))));
    }

    function _create(address from, uint256 nonce) private view returns (address contractAddress) {
        contractAddress = generateAddress(from, nonce);
        require(Util.isContract(contractAddress), "ContractFee: create contract does not exist");
    }

    function _create2(
        address from,
        bytes32 salt,
        bytes32 deployCodeHash,
        bytes32 codeHash
    ) private view returns (address contractAddress) {
        require(codeHash != 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470 && codeHash != 0, "ContractFee: invalid code hash");
        contractAddress = generateAddress2(from, salt, deployCodeHash);
        bytes32 _codeHash;
        assembly {
            _codeHash := extcodehash(contractAddress)
        }
        require(_codeHash == codeHash && Util.isContract(contractAddress), "ContractFee: create2 contract code hash does not match");
    }

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
                parent = _register(parent, _create2(parent, c2i.salt, c2i.deployCodeHash, c2i.codeHash));
            }
        }
    }

    function setFee(address contractAddress, uint256 fee) external override {
        if (contractAddress == msg.sender) {
            require(Util.isContract(contractAddress), "ContractFee: invalid sender");
        } else {
            address creator = creatorOf[contractAddress];
            while (creator != address(0) && creator != msg.sender) {
                creator = creatorOf[creator];
            }
            require(creator != address(0), "ContractFee: invalid sender");
        }
        feeOf[contractAddress] = fee;
    }
}
