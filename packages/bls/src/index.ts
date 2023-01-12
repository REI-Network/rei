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

  /**
   * Import chainsafe bls package
   */
  async init() {
    this.bls = (await import('@chainsafe/bls')).default;
  }

  /**
   * Unlock bls key from disk file
   * @param fileName - bls key filename
   * @param password - AES password
   */
  async unlock(fileName: string, password: string) {
    await this.init();
    const { secretkey, publickey } = this.getSecrectKey(fileName, password);
    this.secretKey = this.bls.SecretKey.fromBytes(secretkey);
    this.publicKey = this.bls.PublicKey.fromHex(publickey);
    console.log('BLS public key: ' + this.publicKey.toHex());
  }

  /**
   * Get bls public key
   * @returns bls public key
   */
  getPublicKey() {
    return this.publicKey;
  }

  private getSecrectKey(fileName: string, passphrase: string) {
    const fullPath = path.isAbsolute(fileName) ? fileName : path.join(this.datadir, fileName);
    const blsStruct = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    const secretkey = decrypt({ encryptedSecretKey: blsStruct.encryptedSecretKey, iv: blsStruct.iv }, passphrase);
    if (this.bls.SecretKey.fromBytes(secretkey).toPublicKey().toHex() !== blsStruct.publicKey) {
      throw new Error('Invalid passphrase');
    } else {
      return { secretkey, publickey: blsStruct.publicKey };
    }
  }

  /**
   * New bls key and save to disk
   * @param passphrase - AES password for storage
   * @returns bls public key and file path
   */
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

  /**
   * Update bls key password
   * @param fileName - bls key filename
   * @param passphrase - old AES password
   * @param newPassphrase - new AES password
   */
  async updateSigner(fileName: string, passphrase: string, newPassphrase: string) {
    await this.init();
    const { secretkey, publickey } = this.getSecrectKey(fileName, passphrase);
    const blsStruct = encrypt(secretkey, newPassphrase);
    const fullPath = path.isAbsolute(fileName) ? fileName : path.join(this.datadir, fileName);
    fs.writeFileSync(fullPath, JSON.stringify({ ...blsStruct, publicKey: publickey }));
  }

  /**
   * Import bls key from secret key
   * @param secretKey - bls secret key
   * @param passphrase - AES password for storage
   * @returns bls public key and file path
   */
  async importSignerBySecretKey(secretKey: string, passphrase: string) {
    await this.init();
    const blsStruct = encrypt(Buffer.from(secretKey, 'hex'), passphrase);
    const publickey = this.bls.SecretKey.fromHex(secretKey).toPublicKey();
    const fullPath = path.join(this.datadir, signerFileName(publickey.toHex()));
    fs.mkdirSync(path.dirname(fullPath), { mode: 0o700, recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify({ ...blsStruct, publicKey: publickey.toHex() }));
    return { publickey: publickey.toHex(), path: fullPath };
  }

  /**
   * Sign message using bls key
   * @param message - message to sign
   * @returns signature
   */
  signMessage(message: Buffer) {
    return this.secretKey.sign(message);
  }

  /**
   * Verify message using bls public key
   * @param signature - signature
   * @param message - message
   * @returns true if signature is valid
   */
  verifyMessage(signature: Buffer, message: Buffer) {
    return this.bls.verify(message, signature, this.publicKey.toBytes());
  }

  /**
   * Aggregate signatures
   * @param signatures - signatures to aggregate
   * @returns aggregated signature
   */
  aggregateSignatures(signatures: Buffer[]) {
    return this.bls.aggregateSignatures(signatures);
  }

  /**
   * Verify aggregated signature
   * @param aggregatedSignature - aggregated signature
   * @param messages - messages
   * @param publicKeys - public keys
   * @returns true if aggregated signature is valid
   */
  verifyMultiple(aggregatedSignature: Buffer, messages: Buffer[], publicKeys: Buffer[]) {
    return this.bls.verifyMultiple(publicKeys, messages, aggregatedSignature);
  }
}
