import { Account } from 'ethereumjs-util';

export interface SlimAccount extends Account {
  slimSerialize(): Buffer;
}

export interface SlimAccountCtor<S> {
  fromRlpSerializedSlimAccount(serialized: Buffer): S;
}
