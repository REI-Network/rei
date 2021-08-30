# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.0.6-alpha.0](https://github.com/gxchain/gxchain2/compare/v0.0.5-alpha.0...v0.0.6-alpha.0) (2021-08-30)


### Bug Fixes

* Fix binary search for findAncient ([a6e048f](https://github.com/gxchain/gxchain2/commit/a6e048fcb04abff63b9178cb5e5c33e1ea427874))


### Features

* add contracts ([a2c1e71](https://github.com/gxchain/gxchain2/commit/a2c1e718f6509abe0e63d74383151e887f08177a))
* add interface ([db586b2](https://github.com/gxchain/gxchain2/commit/db586b2f6f16ff28881971ca43a873a3c2726a88))
* add solidity doc gen ([c0199ef](https://github.com/gxchain/gxchain2/commit/c0199effe3e0b9d5c5ad001f960ddccce97ef65d))
* add unstake keeper ([8c53402](https://github.com/gxchain/gxchain2/commit/8c5340224567523ba6a6c0a860c1fb7d1970b572))
* staking logic ([e7b0703](https://github.com/gxchain/gxchain2/commit/e7b070388b6c0ebefeadb699f5000c5e48eb6f20))





## [0.0.5-alpha.0](https://github.com/gxchain/gxchain2/compare/v0.0.4-alpha.0...v0.0.5-alpha.0) (2021-07-14)

### Reverts

- remove package-lock ([008bdd7](https://github.com/gxchain/gxchain2/commit/008bdd7864503291873f907e1f872f5ac2622a9e))

## [0.0.4-alpha.0](https://github.com/gxchain/gxchain2/compare/v0.0.3-alpha.0...v0.0.4-alpha.0) (2021-07-14)

**Note:** Version bump only for package root

## [0.0.3-alpha.0](https://github.com/gxchain/gxchain2/compare/v0.0.2-alpha.0...v0.0.3-alpha.0) (2021-07-13)

### Bug Fixes

- **network:** handle message after handshake success ([e058166](https://github.com/gxchain/gxchain2/commit/e058166168175b4f63859d5af842363f7377cd76))
- **tx-pool:** fix tx stuck when reorg ([03c8036](https://github.com/gxchain/gxchain2/commit/03c803628932fbafd323114d7c1d898571841e4c))
- add handler to pool after handshake success ([2a6b543](https://github.com/gxchain/gxchain2/commit/2a6b543b6a1b453a780543be38f35ea40c1746ff))
- **rpc:** fix nonce type error ([1350bed](https://github.com/gxchain/gxchain2/commit/1350bed44285e09a07090d290afd84d569e09cd4))
- **tx-pool:** fix tx suck(pending nonce error) ([fe8423d](https://github.com/gxchain/gxchain2/commit/fe8423d357e7b4b1526124f49991f040ab09dafc))
- aborter and channel(channel abort cause memory leak) ([34c7c6d](https://github.com/gxchain/gxchain2/commit/34c7c6d59b849273a9b6e742690071c62a8aa168))
- fix aborter(promise.race cause memory leak) ([87d6eb1](https://github.com/gxchain/gxchain2/commit/87d6eb18840c235ec10f8004f5f533619ace7cd0))
- shouldn't getPrivateKey when don't generate state root ([ebb05c1](https://github.com/gxchain/gxchain2/commit/ebb05c1b5f0ec2eb95125ad0b2e0ba1df423169d))
- tx pool, transaction stuck ([7ea4e31](https://github.com/gxchain/gxchain2/commit/7ea4e313371a37ce1e37d70abd7a8b13b902ae26))
- **core:** fix sync stop ([66f232d](https://github.com/gxchain/gxchain2/commit/66f232db08180176e46c01b0ec710f8ef98aa48f))
- **doc:** add cli to README.md ([096b570](https://github.com/gxchain/gxchain2/commit/096b5700b3751bea27473db1358bd43ff89574f4))
- **doc:** add node version and npm version, update install command ([f2a4a0f](https://github.com/gxchain/gxchain2/commit/f2a4a0f1e533b4b74c5305fe52f266d39fee03aa))
- **doc:** fix README.md ([f25b1bd](https://github.com/gxchain/gxchain2/commit/f25b1bd3a0dc38d00e0065de06bb75e8554cbe58))
- **state-manager:** fix merkle-patricia-tree version bug ([4ef947d](https://github.com/gxchain/gxchain2/commit/4ef947dd15ec918a055bca69cafc881ab8300f72))
- **wallet:** fix keyStoreFileName(startsWith 0x) ([d737f6e](https://github.com/gxchain/gxchain2/commit/d737f6e3cb3ffe1573edaf7b4b5019a305323283))

### Features

- **network:** use discv5 instead of kad-dht ([6baa79c](https://github.com/gxchain/gxchain2/commit/6baa79c73901359a841a265575c70ffa0951c96f))
- add cli wallet ([c45da52](https://github.com/gxchain/gxchain2/commit/c45da527867536448ad3268ec90bee1788c3e891))
- add expheap for inbound and outbound ([79d2050](https://github.com/gxchain/gxchain2/commit/79d2050cab21010af40c233a1c3459ead1adfd9c))
- add unlock option for node, remove fake account manager ([e9648fe](https://github.com/gxchain/gxchain2/commit/e9648fe1773f2bf4f5acdb46b6ab82f125f72a92))
- **core:** add blockchain monitor ([1dc6bce](https://github.com/gxchain/gxchain2/commit/1dc6bced778541aa6e7bde81eddf7a4e1a651b1a))
- **core:** add bloom bits filter ([6977bf8](https://github.com/gxchain/gxchain2/commit/6977bf8eaffed0dd9ddcc851412a20de48aec01c))
- **core:** add bloom bits indexer, change chain indexer backend interface ([fd2e000](https://github.com/gxchain/gxchain2/commit/fd2e000356046b889ded1db15d81158379c97236))
- **core:** add bloombits generator ([07916fd](https://github.com/gxchain/gxchain2/commit/07916fd10dd81bedae22635b9bc895193e6ccac9))
- **core:** add simple chain indexer ([bdb9526](https://github.com/gxchain/gxchain2/commit/bdb9526380e67f10e1a54566ae49566baaacfc18))
- **core:** add tracer for core ([ed30c5f](https://github.com/gxchain/gxchain2/commit/ed30c5f6d51daacb4fb5c9f4c0e6d763638634d9))
- add write and read bloom bits ([fa66a0e](https://github.com/gxchain/gxchain2/commit/fa66a0ed02f5e59985b191582649407c28456e9b))

### Reverts

- Revert "chore: add debug code" ([1b13f64](https://github.com/gxchain/gxchain2/commit/1b13f648dceba66084d66bcd0e956063b2a3c79d))

## [0.0.2-alpha.0](https://iz11ro8cf9xz/node/gxchain2/compare/v0.0.1-alpha.0...v0.0.2-alpha.0) (2021-03-15)

### Bug Fixes

- abort when sync failed ([ae3bd62](https://github.com/gxchain/gxchain2/commit/ae3bd62cefad191d0f0077c5374568d0eb923631))
- add abort check when get next task ([2db3496](https://github.com/gxchain/gxchain2/commit/2db349641d380c828710775970d810f3490e4b2e))
- add encoding-down for objects ([37c04ec](https://github.com/gxchain/gxchain2/commit/37c04ec9944ab2618aff7e555e5b713738894e83))
- add extension for tx ([bff5081](https://github.com/gxchain/gxchain2/commit/bff50813b3d049b60116adcefc696f1fd4475107))
- ban error peer before set idle ([b2a065f](https://github.com/gxchain/gxchain2/commit/b2a065f949e1fe8d16689abde37bb3e17fc3aa82))
- bodies download failed ([4f8ff5b](https://github.com/gxchain/gxchain2/commit/4f8ff5ba62f526c19c10e15886d00adba39116a1))
- boot nodes sync failed ([b343692](https://github.com/gxchain/gxchain2/commit/b34369230ea6d8ab0928053da11cfeeab9ee4cba))
- cache missing ([facaf30](https://github.com/gxchain/gxchain2/commit/facaf30e4094856ecd171a301638fc465e1451fd))
- calculate contractAddress ([4b784ba](https://github.com/gxchain/gxchain2/commit/4b784ba1020148e28d40733c72e3bf6d1da56754))
- can't use promise.all when processBlocks ([48721e3](https://github.com/gxchain/gxchain2/commit/48721e300792dcbdd03ed01d546b0166110463fa))
- connect event ([0b22ee8](https://github.com/gxchain/gxchain2/commit/0b22ee8e05da849e9d7f5a7f2e5733b2124f5918))
- cumulative gas used ([ba5ff52](https://github.com/gxchain/gxchain2/commit/ba5ff52c5c3df224a6a67c9ac0c70886d1d58b61))
- difficult ([046f94d](https://github.com/gxchain/gxchain2/commit/046f94da52dee1e5048df8e86612f64f96686de8))
- fetcher priority queue ([aa0a1e2](https://github.com/gxchain/gxchain2/commit/aa0a1e2a4a7701017b362ecdd95f17e94f1d3e97))
- fix rlpencode and task.count calculate ([ac3819e](https://github.com/gxchain/gxchain2/commit/ac3819e0804864e441f02c4343a59f1301d222dd))
- full sync failed ([fa34a97](https://github.com/gxchain/gxchain2/commit/fa34a97747f70cf3189c73e482143aa09eea3902))
- full sync failed ([e4d7c77](https://github.com/gxchain/gxchain2/commit/e4d7c7704b83cd09891ec330d1b811a45b0d8ae1))
- functional map repeated insert ([0408a43](https://github.com/gxchain/gxchain2/commit/0408a4306f0d3792d22930d38286ffb8892c3c21))
- funtional map iterator undefined ([736e4b5](https://github.com/gxchain/gxchain2/commit/736e4b5aad98be5b0a5eb103ba2a3fab75b963b0))
- generate block ([5a0e78b](https://github.com/gxchain/gxchain2/commit/5a0e78ba9f377a2a5282a8ef5f01d4cd510d7518))
- GetBlockBodies failed ([1d58e7f](https://github.com/gxchain/gxchain2/commit/1d58e7f04c36d6d2ec58f3bca969b4d725f3a5fe))
- heap undefined ([c240f81](https://github.com/gxchain/gxchain2/commit/c240f819645f658c449f3fec195fdcbf36fcb16a))
- heap.size ([55f97a7](https://github.com/gxchain/gxchain2/commit/55f97a7f6afb86e03833f388d3ae28360fc3ff4a))
- improve tx-pool addTxs logic ([85cd1e2](https://github.com/gxchain/gxchain2/commit/85cd1e2b52402b78a36c0e465f6fc37050c0b0d7))
- init txpool before init blockchain ([324df64](https://github.com/gxchain/gxchain2/commit/324df64ebf047d0c1d3e0e921cf5903351164f5a))
- insert task when run over ([f9eec1c](https://github.com/gxchain/gxchain2/commit/f9eec1c0a1e7fa5b230cafa2a0e69b7b2b7052a0))
- iterator again ([53a08b1](https://github.com/gxchain/gxchain2/commit/53a08b1a1134d557c4063092a0187d7f174db37c))
- latest block of blockchain ([4ce576b](https://github.com/gxchain/gxchain2/commit/4ce576bcafca25c64bbdffc043e85edca0b45b74))
- peer.idle ([01b7d0a](https://github.com/gxchain/gxchain2/commit/01b7d0a1d8f6f2db955ab032954b97aeb87a0212))
- prompts lsblock and decode receipt ([7f61505](https://github.com/gxchain/gxchain2/commit/7f61505e19eed8df2e4cb55411b795f52aa3896c))
- queue.push ([860dfea](https://github.com/gxchain/gxchain2/commit/860dfea4949bee743a4a142cd65a2b8817386c8a))
- rlp.encode BlockHeaders ([d52baa2](https://github.com/gxchain/gxchain2/commit/d52baa28b2df0579808a76f56c6c99f55f3371a0))
- rpc dependents ([0154211](https://github.com/gxchain/gxchain2/commit/015421155b7bfb0d03371380c02f335216523d67))
- saveTxLookup ([4093819](https://github.com/gxchain/gxchain2/commit/4093819a8c73e0376e93d153609300a9420571c2))
- set peer idle before insert task ([9414d40](https://github.com/gxchain/gxchain2/commit/9414d40fa5af8ea958b18aa55c2f62de9359fb92))
- state root ([f27e125](https://github.com/gxchain/gxchain2/commit/f27e125085a16047d13eda0649bb50d7937a91f5))
- stateRoot ([45a19ee](https://github.com/gxchain/gxchain2/commit/45a19ee66a4b4556ecd6f94d1e0561bacfa5ca57))
- sync block and get idle peer ([42ed820](https://github.com/gxchain/gxchain2/commit/42ed8200b2c772a51d0d189ecbc2e4d226304f16))
- sync failed ([762ec22](https://github.com/gxchain/gxchain2/commit/762ec223852c497ece7dc40f268dca72bb343bea))
- sync logic ([61178b4](https://github.com/gxchain/gxchain2/commit/61178b4561039d13eded24dbe266982b8a30a134))
- sync logic again ([d943409](https://github.com/gxchain/gxchain2/commit/d943409305f67510b30a17c0b80a0e6b2255f29b))
- sync stop ([22bfabf](https://github.com/gxchain/gxchain2/commit/22bfabff8f64b8633616ff7781ae19be824b1b14))
- sync stop again ([9a91b1b](https://github.com/gxchain/gxchain2/commit/9a91b1bcf9f2250fdabe81e308321aca1f7727c9))
- transaction value error ([afe2986](https://github.com/gxchain/gxchain2/commit/afe29864fc7074c4723603dff70c34f982cfdf84))
- ts target ([d20aa2a](https://github.com/gxchain/gxchain2/commit/d20aa2ad9a039f159f47c6260cf44e14f7c819cf))
- **core:** fix init libp2p ([d3f8488](https://github.com/gxchain/gxchain2/commit/d3f8488cd3b30ec7f6cddd15a2445fc3e7ca88b3))
- **network:** fix p2p handshake failed ([c19d025](https://github.com/gxchain/gxchain2/commit/c19d025d0c5975903518bf8d733c8482ca08088a))
- **network:** init libp2p ([9e0ac68](https://github.com/gxchain/gxchain2/commit/9e0ac68d68f0146af56c45a90733605851800640))

### Features

- add aborter ([0eaf73d](https://github.com/gxchain/gxchain2/commit/0eaf73d71be25fe980381dafe7c156444ed29268))
- add asyncnext ([9482dd8](https://github.com/gxchain/gxchain2/commit/9482dd8bb7e84dac83aef42b86a385bd0f97723e))
- add block and blockchain ([e821fb9](https://github.com/gxchain/gxchain2/commit/e821fb9004470cd70c56e88065edd444b9744433))
- add block impl and remove useless ethash ([43ad3bb](https://github.com/gxchain/gxchain2/commit/43ad3bbb534ff42a62883051b82ac446db4b6d2e))
- add blockchain impl ([446f52e](https://github.com/gxchain/gxchain2/commit/446f52e20a48050a6af3c0db8ea0c8cb35ed2aca))
- add database impl ([9db55d0](https://github.com/gxchain/gxchain2/commit/9db55d0121bde4134e72899c7b2e19ef2aaa752b))
- add functional map basing on rbtree ([dd63019](https://github.com/gxchain/gxchain2/commit/dd6301967d25a13b28a432a3f2edd57d3d3f9fe4))
- add gxchain-receipt ([ce88c91](https://github.com/gxchain/gxchain2/commit/ce88c91f6749a453b6c00d51f136b8d5f77302dd))
- add headerFetcher and bodiesFetcher ([3c7e1e1](https://github.com/gxchain/gxchain2/commit/3c7e1e1d20c0e2d93884294145137a61e2e3d0e7))
- add index.ts ([fcdc8b3](https://github.com/gxchain/gxchain2/commit/fcdc8b31b408b2e6d99adc409b2f79c9f54ae2be))
- add orderedqueue ([9f0da88](https://github.com/gxchain/gxchain2/commit/9f0da8897236984dd388fbfdfea6f9204ec94091))
- add sync ([25f1c55](https://github.com/gxchain/gxchain2/commit/25f1c55582e269afff6b54989e452918dde2399d))
- add the simple rpc-module ([5914ba5](https://github.com/gxchain/gxchain2/commit/5914ba54465b0291d36ee985ea400552827d0c33))
- add tx block blockchain ([cababb6](https://github.com/gxchain/gxchain2/commit/cababb64ebdbf8872cdb0eb2ffa50c4e35f27622))
- add tx impl ([4ac8fdb](https://github.com/gxchain/gxchain2/commit/4ac8fdb7910b9118e29f53fda83252f5e792506d))
- add vm impl ([87ff75d](https://github.com/gxchain/gxchain2/commit/87ff75dddf0c8afa7afb5ea7d6bc22b6af707c78))
- **network:** add peerpool and change constructor ([8f45e7c](https://github.com/gxchain/gxchain2/commit/8f45e7cb8c79189919df3b8bb66753b85d51df2b))
- tx pool ([6aee8ee](https://github.com/gxchain/gxchain2/commit/6aee8eecfbf396ce3bb220582e980d606fbf03b2))

## 0.0.1-alpha.0 (2020-11-24)

### Bug Fixes

- fix eslint error ([d4383fc](https://github.com/gxchain/gxchain2/commit/d4383fc6e9bc65e81d152e57c172385e212fddf0))
- remove mdns ([193e15e](https://github.com/gxchain/gxchain2/commit/193e15e0c0521b692a671753e35aa6a2a4ab968a))

### Features

- **@gxchain2/crypto:** add basic crypto functions ([82696fc](https://github.com/gxchain/gxchain2/commit/82696fc4f62f909f434d1e651a2017b869c36527))

### Reverts

- Revert "chore: update initial version for initial publish" ([302c8d7](https://github.com/gxchain/gxchain2/commit/302c8d7c59740e91e434c282079126225c8b72aa))
