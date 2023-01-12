import fs from 'fs';
import path from 'path';
import { decrypt, encrypt, signerFileName } from './utils';
import { Bls, SecretKey, PublicKey } from './types';

export class BlsManager {
  private publicKey!: PublicKey;
  private secretKey!: SecretKey;
  private bls!: Bls;
  private datadir: string;

  constructor(datadir: string) {
    this.datadir = datadir;
  }

  async init() {
    this.bls = (await import('@chainsafe/bls')).default;
  }

  async unlock(fullPath: string, passphrase: string) {
    await this.init();
    const secretkey = this.getSecrectKey(fullPath, passphrase);
    this.secretKey = this.bls.SecretKey.fromBytes(secretkey);
    this.publicKey = this.secretKey.toPublicKey();
  }

  getPublicKey() {
    return this.publicKey;
  }

  private getSecrectKey(fullPath: string, passphrase: string) {
    const blsStruct = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    const secretkey = decrypt({ encryptedSecretKey: blsStruct.encryptedSecretKey, iv: blsStruct.iv }, passphrase);
    if (this.bls.SecretKey.fromBytes(secretkey).toPublicKey().toHex() !== blsStruct.publicKey) {
      throw new Error('Invalid passphrase');
    } else {
      return secretkey;
    }
  }

  async newSigner(passphrase: string) {
    await this.init();
    const secretkey = this.bls.SecretKey.fromKeygen();
    const publickey = secretkey.toPublicKey();
    const fullPath = path.join(this.datadir, signerFileName(publickey.toHex()));
    fs.mkdirSync(path.dirname(fullPath), { mode: 0o700, recursive: true });
    const blsStruct = encrypt(secretkey.toBytes(), passphrase);
    fs.writeFileSync(fullPath, JSON.stringify({ ...blsStruct, publicKey: publickey.toHex() }));
    return { publickey: publickey.toHex(), path: fullPath };
  }

  async updateSigner(fileName: string, passphrase: string, newPassphrase: string) {
    await this.init();
    const fullPath = path.join(this.datadir, fileName);
    const secretkey = this.getSecrectKey(fullPath, passphrase);
    const blsStruct = encrypt(secretkey, newPassphrase);
    fs.writeFileSync(fullPath, JSON.stringify({ ...blsStruct, publicKey: this.bls.SecretKey.fromBytes(secretkey).toPublicKey().toHex() }));
  }

  async importSignerBySecretKey(secretKey: string, passphrase: string) {
    await this.init();
    const blsStruct = encrypt(Buffer.from(secretKey, 'hex'), passphrase);
    const publickey = this.bls.SecretKey.fromHex(secretKey).toPublicKey();
    const fullPath = path.join(this.datadir, signerFileName(publickey.toHex()));
    fs.mkdirSync(path.dirname(fullPath), { mode: 0o700, recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify({ ...blsStruct, publicKey: publickey.toHex() }));
    return { publickey: publickey.toHex(), path: fullPath };
  }

  signMessage(message: Buffer) {
    return this.secretKey.sign(message);
  }

  verifyMessage(signature: Buffer, message: Buffer) {
    return this.bls.verify(message, signature, this.publicKey.toBytes());
  }

  aggregateSignatures(signatures: Buffer[]) {
    return this.bls.aggregateSignatures(signatures);
  }

  verifyMultiple(aggregatedSignature: Buffer, messages: Buffer[], publicKeys: Buffer[]) {
    return this.bls.verifyMultiple(publicKeys, messages, aggregatedSignature);
  }
}
