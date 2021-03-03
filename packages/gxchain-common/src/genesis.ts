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
      type: 'poa'
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
        block: 0,
        forkHash: '0xfc64ec04'
      },
      {
        name: 'homestead',
        block: 1150000,
        forkHash: '0x97c2c34c'
      },
      {
        name: 'dao',
        block: 1920000,
        forkHash: '0x91d1f948'
      },
      {
        name: 'tangerineWhistle',
        block: 2463000,
        forkHash: '0x7a64da13'
      },
      {
        name: 'spuriousDragon',
        block: 2675000,
        forkHash: '0x3edd5b10'
      },
      {
        name: 'byzantium',
        block: 4370000,
        forkHash: '0xa00bc324'
      },
      {
        name: 'constantinople',
        block: 7280000,
        forkHash: '0x668db0af'
      },
      {
        name: 'petersburg',
        block: 7280000,
        forkHash: '0x668db0af'
      },
      {
        name: 'istanbul',
        block: 9069000,
        forkHash: '0x879d6e30'
      },
      {
        name: 'muirGlacier',
        block: 9200000,
        forkHash: '0xe029e991'
      },
      {
        name: 'berlin',
        block: null,
        forkHash: null
      }
    ],
    bootstrapNodes: [],
    poa: ['0x3289621709f5b35d09b4335e129907ac367a0593']
  }
};
