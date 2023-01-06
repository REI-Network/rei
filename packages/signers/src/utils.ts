import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { keccak256 } from 'ethereumjs-util';

const algorithm = 'aes-256-ctr';

export type cryptoStruct = {
  secretKey: string;
  iv: string;
};

export function encrypt(message: string, passphrase: string): cryptoStruct {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, keccak256(Buffer.from(passphrase)), iv);
  const encrypted = Buffer.concat([cipher.update(message), cipher.final()]);
  return {
    secretKey: encrypted.toString('hex'),
    iv: iv.toString('hex')
  };
}

export function decrypt(secretStruct: cryptoStruct, passphrase: string): string {
  const iv = Buffer.from(secretStruct.iv, 'hex');
  const encryptedText = Buffer.from(secretStruct.secretKey, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, keccak256(Buffer.from(passphrase)), iv);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString();
}
