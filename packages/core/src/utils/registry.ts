export interface ContructorWithCode<T> {
  new (...args: any[]): T;
  readonly code: number;
}

/**
 * A simple registry class,
 * which can register classes according to a number
 */
export class Registry<T, U extends ContructorWithCode<T>> {
  private codeToCtor = new Map<number, U>();

  /**
   * Register a class
   * @param p - Class
   */
  register(p: U) {
    if (this.codeToCtor.has(p.code)) {
      throw new Error('duplicate registration');
    }
    this.codeToCtor.set(p.code, p);
  }

  /**
   * Get class code by instance
   * @param _p - Instance
   * @returns Code
   */
  getCodeByInstance(_p: T) {
    for (const [code, p] of this.codeToCtor) {
      if (_p instanceof p) {
        return code;
      }
    }
    throw new Error('unknown instance');
  }

  /**
   * Get class by code
   * @param code - Code
   * @returns Class
   */
  getCtorByCode(code: number) {
    const p = this.codeToCtor.get(code);
    if (p === undefined) {
      throw new Error(`unknown code: ${code}`);
    }
    return p;
  }
}
