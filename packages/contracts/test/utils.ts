import { ethers } from 'hardhat';
import { BN } from 'ethereumjs-util';

export async function upTimestamp(deployer: string, time: number) {
  // wait some time and send a transaction to update blockchain timestamp
  await new Promise((r) => setTimeout(r, time * 1000 + 10));
  await (
    await ethers.getSigner(deployer)
  ).sendTransaction({
    to: deployer,
    value: 0
  });
}

export function toBN(data: number | string) {
  if (typeof data === 'string' && data.startsWith('0x')) {
    return new BN(data.substr(2), 'hex');
  }
  return new BN(data);
}
