export interface ContructorWithCode<T> {
  new (...args: any[]): T;
  readonly code: number;
}

export class Registry<T, U extends ContructorWithCode<T>> {
  private codeToCtor = new Map<number, U>();

  register(p: U) {
    if (this.codeToCtor.has(p.code)) {
      throw new Error('duplicate registration');
    }
    this.codeToCtor.set(p.code, p);
  }

  getCodeByInstance(_p: T) {
    for (const [code, p] of this.codeToCtor) {
      if (_p instanceof p) {
        return code;
      }
    }
    throw new Error('unknown instance');
  }

  getCtorByCode(code: number) {
    const p = this.codeToCtor.get(code);
    if (p === undefined) {
      throw new Error(`unknown code: ${code}`);
    }
    return p;
  }
}
