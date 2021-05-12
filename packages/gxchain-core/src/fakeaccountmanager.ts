// TODO: remove this.
const keyPair = new Map<string, Buffer>([
  ['3289621709f5b35d09b4335e129907ac367a0593', Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex')],
  ['d1e52f6eacbb95f5f8512ff129cbd6360e549b0b', Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex')],
  ['b4ec1f6419d66bfacebdd5b53fa895a636473c39', Buffer.from('13f00a78701e93dbb32d2b8618792c319a83a91423679f0a65be51a9eb56ec85', 'hex')]
]);

export function getPrivateKey(address: string) {
  if (!keyPair.has(address)) {
    throw new Error(`Unknow address: ${address}`);
  }
  return keyPair.get(address)!;
}
