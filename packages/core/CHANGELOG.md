# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.0.5-alpha.0](https://github.com/gxchain/gxchain2/compare/v0.0.4-alpha.0...v0.0.5-alpha.0) (2021-07-14)


### Reverts

* remove package-lock ([008bdd7](https://github.com/gxchain/gxchain2/commit/008bdd7864503291873f907e1f872f5ac2622a9e))





## [0.0.4-alpha.0](https://github.com/gxchain/gxchain2/compare/v0.0.3-alpha.0...v0.0.4-alpha.0) (2021-07-14)

**Note:** Version bump only for package @gxchain2/core





## [0.0.3-alpha.0](https://github.com/gxchain/gxchain2/compare/v0.0.2-alpha.0...v0.0.3-alpha.0) (2021-07-13)


### Bug Fixes

* **network:** handle message after handshake success ([e058166](https://github.com/gxchain/gxchain2/commit/e058166168175b4f63859d5af842363f7377cd76))
* **tx-pool:** fix tx stuck when reorg ([03c8036](https://github.com/gxchain/gxchain2/commit/03c803628932fbafd323114d7c1d898571841e4c))
* add handler to pool after handshake success ([2a6b543](https://github.com/gxchain/gxchain2/commit/2a6b543b6a1b453a780543be38f35ea40c1746ff))


### Features

* **network:** use discv5 instead of kad-dht ([6baa79c](https://github.com/gxchain/gxchain2/commit/6baa79c73901359a841a265575c70ffa0951c96f))





## [0.0.2-alpha.0](https://iz11ro8cf9xz/node/gxchain2/compare/v0.0.1-alpha.0...v0.0.2-alpha.0) (2021-03-15)


### Bug Fixes

* abort when sync failed ([ae3bd62](https://iz11ro8cf9xz/node/gxchain2/commits/ae3bd62cefad191d0f0077c5374568d0eb923631))
* ban error peer before set idle ([b2a065f](https://iz11ro8cf9xz/node/gxchain2/commits/b2a065f949e1fe8d16689abde37bb3e17fc3aa82))
* bodies download failed ([4f8ff5b](https://iz11ro8cf9xz/node/gxchain2/commits/4f8ff5ba62f526c19c10e15886d00adba39116a1))
* boot nodes sync failed ([b343692](https://iz11ro8cf9xz/node/gxchain2/commits/b34369230ea6d8ab0928053da11cfeeab9ee4cba))
* cache missing ([facaf30](https://iz11ro8cf9xz/node/gxchain2/commits/facaf30e4094856ecd171a301638fc465e1451fd))
* can't use promise.all when processBlocks ([48721e3](https://iz11ro8cf9xz/node/gxchain2/commits/48721e300792dcbdd03ed01d546b0166110463fa))
* connect event ([0b22ee8](https://iz11ro8cf9xz/node/gxchain2/commits/0b22ee8e05da849e9d7f5a7f2e5733b2124f5918))
* difficult ([046f94d](https://iz11ro8cf9xz/node/gxchain2/commits/046f94da52dee1e5048df8e86612f64f96686de8))
* fetcher priority queue ([aa0a1e2](https://iz11ro8cf9xz/node/gxchain2/commits/aa0a1e2a4a7701017b362ecdd95f17e94f1d3e97))
* fix rlpencode and task.count calculate ([ac3819e](https://iz11ro8cf9xz/node/gxchain2/commits/ac3819e0804864e441f02c4343a59f1301d222dd))
* full sync failed ([fa34a97](https://iz11ro8cf9xz/node/gxchain2/commits/fa34a97747f70cf3189c73e482143aa09eea3902))
* init txpool before init blockchain ([324df64](https://iz11ro8cf9xz/node/gxchain2/commits/324df64ebf047d0c1d3e0e921cf5903351164f5a))
* peer.idle ([01b7d0a](https://iz11ro8cf9xz/node/gxchain2/commits/01b7d0a1d8f6f2db955ab032954b97aeb87a0212))
* saveTxLookup ([4093819](https://iz11ro8cf9xz/node/gxchain2/commits/4093819a8c73e0376e93d153609300a9420571c2))
* set peer idle before insert task ([9414d40](https://iz11ro8cf9xz/node/gxchain2/commits/9414d40fa5af8ea958b18aa55c2f62de9359fb92))
* state root ([f27e125](https://iz11ro8cf9xz/node/gxchain2/commits/f27e125085a16047d13eda0649bb50d7937a91f5))
* stateRoot ([45a19ee](https://iz11ro8cf9xz/node/gxchain2/commits/45a19ee66a4b4556ecd6f94d1e0561bacfa5ca57))
* sync block and get idle peer ([42ed820](https://iz11ro8cf9xz/node/gxchain2/commits/42ed8200b2c772a51d0d189ecbc2e4d226304f16))
* sync failed ([762ec22](https://iz11ro8cf9xz/node/gxchain2/commits/762ec223852c497ece7dc40f268dca72bb343bea))
* sync logic ([61178b4](https://iz11ro8cf9xz/node/gxchain2/commits/61178b4561039d13eded24dbe266982b8a30a134))
* sync logic again ([d943409](https://iz11ro8cf9xz/node/gxchain2/commits/d943409305f67510b30a17c0b80a0e6b2255f29b))
* sync stop ([22bfabf](https://iz11ro8cf9xz/node/gxchain2/commits/22bfabff8f64b8633616ff7781ae19be824b1b14))
* sync stop again ([9a91b1b](https://iz11ro8cf9xz/node/gxchain2/commits/9a91b1bcf9f2250fdabe81e308321aca1f7727c9))
* **core:** fix init libp2p ([d3f8488](https://iz11ro8cf9xz/node/gxchain2/commits/d3f8488cd3b30ec7f6cddd15a2445fc3e7ca88b3))


### Features

* add blockchain impl ([446f52e](https://iz11ro8cf9xz/node/gxchain2/commits/446f52e20a48050a6af3c0db8ea0c8cb35ed2aca))
* add headerFetcher and bodiesFetcher ([3c7e1e1](https://iz11ro8cf9xz/node/gxchain2/commits/3c7e1e1d20c0e2d93884294145137a61e2e3d0e7))
* add sync ([25f1c55](https://iz11ro8cf9xz/node/gxchain2/commits/25f1c55582e269afff6b54989e452918dde2399d))
* add vm impl ([87ff75d](https://iz11ro8cf9xz/node/gxchain2/commits/87ff75dddf0c8afa7afb5ea7d6bc22b6af707c78))
* **network:** add peerpool and change constructor ([8f45e7c](https://iz11ro8cf9xz/node/gxchain2/commits/8f45e7cb8c79189919df3b8bb66753b85d51df2b))
* tx pool ([6aee8ee](https://iz11ro8cf9xz/node/gxchain2/commits/6aee8eecfbf396ce3bb220582e980d606fbf03b2))





## 0.0.1-alpha.0 (2020-11-24)


### Bug Fixes

* fix eslint error ([d4383fc](https://iz11ro8cf9xz/node/gxchain2/commits/d4383fc6e9bc65e81d152e57c172385e212fddf0))
