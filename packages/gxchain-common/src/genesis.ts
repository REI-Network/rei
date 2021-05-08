export const defaultGenesis = {
  accountInfo: {
    '0x3289621709f5b35d09b4335e129907ac367a0593': {
      balance: '0x1111111',
      code: '',
      nonce: '0x00',
      storage: {}
    },
    '0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b': {
      balance: '0x1111111',
      code: '',
      nonce: '0x00',
      storage: {}
    }
  },
  genesisInfo: {
    consensus: {
      type: 'pow'
    },
    name: 'gxc2',
    chainId: 12358,
    networkId: 12358,
    comment: 'The gxchain2.0 main chain',
    url: 'https://does.not.exist/',
    genesis: {
      bloom:
        '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      coinbase: '0x8888f1f195afa192cfee860698584c030f4c9db1',
      difficulty: '0x020000',
      extraData: '0x42',
      gasLimit: '0xbe5c8b',
      gasUsed: '0x00',
      hash: '0x70bc9feb9b82fabf799b6f511b9a0c8c89afacd2ce42cb34ed94cab5f54ab8c9',
      mixHash: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      nonce: '0x0102030405060708',
      number: '0x00',
      parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      receiptTrie: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      stateRoot: '0xe132066795abcca2e7c94f37db52bb376ba9e1bf25b73564f3207155a65d88c7',
      timestamp: '0x54c98c81',
      transactionsTrie: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347'
    },
    hardforks: [
      {
        name: 'chainstart',
        block: 0
      },
      {
        name: 'homestead',
        block: 0
      },
      {
        name: 'dao',
        block: null
      },
      {
        name: 'tangerineWhistle',
        block: 0
      },
      {
        name: 'spuriousDragon',
        block: 0
      },
      {
        name: 'byzantium',
        block: 0
      },
      {
        name: 'constantinople',
        block: 0
      },
      {
        name: 'petersburg',
        block: 0
      },
      {
        name: 'istanbul',
        block: 0
      },
      {
        name: 'muirGlacier',
        block: 0
      },
      {
        name: 'berlin',
        block: 0
      }
    ],
    bootstrapNodes: [],
    poa: ['0x3289621709f5b35d09b4335e129907ac367a0593']
  }
};
