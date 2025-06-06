import crypto from 'crypto';
import { keccak256 } from 'ethereumjs-util';
import { cryptoStruct } from './types';

const algorithm = 'aes-256-ctr';

/**
 * Encrypt Message using ase algorithm
 * @param key - secret key
 * @param passphrase - AES password
 * @returns encrypted secret key and iv
 */
export function encrypt(key: Uint8Array, passphrase: string): cryptoStruct {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    algorithm,
    keccak256(Buffer.from(passphrase)),
    iv
  );
  const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
  return {
    encryptedSecretKey: encrypted.toString('hex'),
    iv: iv.toString('hex')
  };
}

/**
 * Decrypt Message using ase algorithm
 * @param secretStruct - encrypted secret key and iv
 * @param passphrase - AES password
 * @returns  decrypted secret key
 */
export function decrypt(
  secretStruct: cryptoStruct,
  passphrase: string
): Buffer {
  const iv = Buffer.from(secretStruct.iv, 'hex');
  const encryptedText = Buffer.from(secretStruct.encryptedSecretKey, 'hex');
  const decipher = crypto.createDecipheriv(
    algorithm,
    keccak256(Buffer.from(passphrase)),
    iv
  );
  const decrypted = Buffer.concat([
    decipher.update(encryptedText),
    decipher.final()
  ]);
  return decrypted;
}

/**
 * Generate signer file name
 * @param publicKey - bls public key
 * @returns signer file name
 */
export function signerFileName(publicKey: string): string {
  const ts = new Date();
  const utc = new Date(ts.getTime() + ts.getTimezoneOffset() * 60000);
  const format = utc.toISOString().replace(/:/g, '-');
  return 'UTC--' + format + '--' + publicKey + '.json';
}
