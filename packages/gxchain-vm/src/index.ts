// import { BN } from 'ethereumjs-util';
// import Common from '@ethereumjs/common';
import VM from '@ethereumjs/vm';
export default VM;

/*
const common = new Common({ chain: 'mainnet' });
const vm = new VM({ common });

const STOP = '00';
const ADD = '01';
const PUSH1 = '60';

// Note that numbers added are hex values, so '20' would be '32' as decimal e.g.
const code = [PUSH1, '03', PUSH1, '05', ADD, STOP];

vm.on('step', function (data) {
  console.log(`Opcode: ${data.opcode.name}\tStack: ${data.stack}`);
});

vm.runCode({
  code: Buffer.from(code.join(''), 'hex'),
  gasLimit: new BN(0xffff)
})
  .then((results) => {
    console.log(`Returned: ${results.returnValue.toString('hex')}`);
    console.log(`gasUsed : ${results.gasUsed.toString()}`);
  })
  .catch(console.error);
*/
