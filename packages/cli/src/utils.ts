import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

/**
 * Get passphrase, if the user specifies the file, read from the file, if not, let the user input
 * @param password - Password
 * @param options.address - Address that requires passphrase
 * @param options.repeat - Does the user need to enter the passphrase twice
 * @param options.message - Message displayed when the user enters the passphrase
 * @param options.forceInput - Whether to force the user to enter the passphrase
 * @returns
 */
export async function getPassphrase(password?: string, options?: { addresses?: string[]; repeat?: boolean; message?: string; forceInput?: boolean }) {
  let passphrase: string[];
  if (!options?.forceInput && password) {
    const realPassword = fs.readFileSync(password).toString();
    passphrase = realPassword.split('\n').map((p) => p.trim());
    if (options?.addresses && passphrase.length < options.addresses.length) {
      throw new Error('Passphrase length is less than addresses length');
    }
  } else {
    async function getSinglePassphrase(address?: string): Promise<string> {
      if (address) {
        console.log(`Please input the password of account ${address.startsWith('0x') ? address.substr(2) : address}`);
      } else if (options?.message) {
        console.log(options.message);
      }

      const result = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: 'Password:'
        }
      ]);
      if (options?.repeat) {
        const result2 = await inquirer.prompt([
          {
            type: 'password',
            name: 'password',
            message: 'Repeat password:'
          }
        ]);
        if (result.password !== result2.password) {
          throw new Error('You must input the same password!');
        }
      }
      return result.password;
    }
    if (!options?.addresses) {
      passphrase = [await getSinglePassphrase()];
    } else {
      passphrase = [];
      for (const address of options.addresses) {
        passphrase.push(await getSinglePassphrase(address));
      }
    }
  }
  return passphrase;
}

export function getKeyStorePath(opts: { [option: string]: string }) {
  return path.join(opts.datadir, opts.keystore);
}

export function getBlsPath(opts: { [option: string]: string }) {
  return path.join(opts.datadir, opts.bls);
}

export function loadVersion() {
  // load version from package.json
  let version = 'unknown';
  try {
    version = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')).toString()).version;
    version = version ?? 'unknown';
  } catch (err) {
    // ignore errors...
  }
  return version;
}
