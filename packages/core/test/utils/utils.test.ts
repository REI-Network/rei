import { expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { validatorsDecode, validatorsEncode } from '../../src/utils';

describe('ValidatorsEncoder', () => {
  const d1 = [1, 600, 255, 0, 510, 5, 6, 7, 15, 100, 199, 200, 333, 444, 555, 666, 777, 12, 23, 3, 4];
  const d2 = [
    new BN('-65563450503415134607105390'),
    new BN('5732362310717439977931090'),
    new BN('-22547420707166045560960791'),
    new BN('21213665443274320577070226'),
    new BN('-42776830187954514430080594'),
    new BN('-31275466561923548857583588'),
    new BN('-5317740020488374657445925'),
    new BN('-31472743459041666467378126'),
    new BN('51547524023593805262272268'),
    new BN('-66494083310561075261751782'),
    new BN('-24229831317987047764276990'),
    new BN('-45617671301921832086854024'),
    new BN('-62752924224706786497199307'),
    new BN('38878264510129469605168281'),
    new BN('40209544849285773607536285'),
    new BN('36251582344401660543689767'),
    new BN('54990213188672028862390257'),
    new BN('-28047233096671637192338945'),
    new BN('30048464444918914690709735'),
    new BN('626834724978240483655586'),
    new BN('48404832182288457154182435')
  ];
  it('should encode validators index list to buffer', async () => {
    const buffer = validatorsEncode(d1, d2);
    expect(buffer).to.be.instanceOf(Buffer);
  });
  it('should decode buffer to validators index list', async () => {
    const buffer = validatorsEncode(d1, d2);
    const { indexList, priorityList } = validatorsDecode(buffer);
    console.log(indexList);
    console.log(priorityList.map((item) => item.toString()));
  });
});
