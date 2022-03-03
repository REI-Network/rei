export interface SlimAccount {
  slimSerialize(): Buffer;
}

export interface SlimAccountCtor {
  new (...args: any[]): SlimAccount;
  fromRlpSerializedSlimAccount(serialized: Buffer): SlimAccount;
}
