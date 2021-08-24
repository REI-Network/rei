import { expect } from 'chai';
import { throwRpcErr, validateJsonRpcVersion, validateJsonRpcMethod, isNil, isFunction, validateConfig, executeHook } from '../src/helper';
import error from '../src/errorcodes';

describe('Helper', () => {
  it('should throw rpc error', () => {
    const code = 500;
    const message = 'JSON-RPC error';
    try {
      throwRpcErr();
    } catch (e) {
      expect(e.code, 'error code should be equal').be.equal(code);
      expect(e.message, 'error message should be equal').be.equal(message);
    }
  });

  it('should validateJsonRpcVersion', () => {
    const version = 'version';
    const requiredVersion = 'requiredVersion';
    const errorMessage = `${error.INVALID_REQUEST.message}, wrong version - ${version}`;
    try {
      validateJsonRpcVersion(version, requiredVersion);
    } catch (e) {
      expect(e.code, 'error code should be equal').be.equal(error.INVALID_REQUEST.code);
      expect(e.message, 'error message should be equal').be.equal(errorMessage);
    }
  });

  it('should validateJsonRpcMethod', () => {
    const method1 = 'method1';
    const method4 = 'method4';
    const controllers = [{ method1: () => {} }, { method2: () => {} }, { method3: () => {} }];
    validateJsonRpcMethod(method1, controllers);
    try {
      validateJsonRpcMethod(method4, controllers);
    } catch (e) {
      expect(e.code, 'error code should be equal').be.equal(error.METHOD_NOT_FOUND.code);
      expect(e.message, 'error message should be equal').be.equal(`${error.METHOD_NOT_FOUND.message} - ${method4}`);
    }
  });

  it('should isNil operate normally', () => {
    const test1 = null;
    const test2 = 'hello';
    expect(isNil(test1), 'should be true').be.true;
    expect(isNil(test2), 'should be false').be.false;
  });

  it('should isFunction operate normally', () => {
    const test1 = () => {};
    const test2 = 'hello';
    expect(isFunction(test1), 'should be true').be.true;
    expect(isFunction(test2), 'should be false').be.false;
  });

  it('should validateConfig', () => {
    const config1 = 'hello';
    const config2 = {};
    const config3 = { methods: [], beforeMethods: 'hello' };
    const config4 = { methods: [{ method1: () => {} }, { method2: () => {} }], beforeMethods: { method3: () => {} } };
    const config5 = { methods: [], afterMethods: 'hello' };
    const config6 = { methods: [{ method1: () => {} }, { method2: () => {} }], afterMethods: { method3: () => {} } };
    const config7 = { methods: [], onError: 'hello' };
    try {
      validateConfig(config1);
    } catch (e) {
      expect(e.message, 'error message should be equal').be.equal('JSON-RPC error: userConfig should be an object.');
    }
    try {
      validateConfig(config2);
    } catch (e) {
      expect(e.message, 'error message should be equal').be.equal('JSON-RPC error: methods should be an array');
    }
    try {
      validateConfig(config3);
    } catch (e) {
      expect(e.message, 'error message should be equal').be.equal('JSON-RPC error: beforeMethods should be an object');
    }
    try {
      validateConfig(config4);
    } catch (e) {
      expect(e.message, 'error message should be equal').be.equal(`JSON-RPC error: beforeMethod should have the same name as method, passed: ${Object.keys(config4.beforeMethods)[0]}`);
    }
    try {
      validateConfig(config5);
    } catch (e) {
      expect(e.message, 'error message should be equal').be.equal('JSON-RPC error: afterMethods should be an object');
    }
    try {
      validateConfig(config6);
    } catch (e) {
      expect(e.message, 'error message should be equal').be.equal(`JSON-RPC error: afterMethods should have the same name as method, passed: ${Object.keys(config6.afterMethods)[0]}`);
    }
    try {
      validateConfig(config7);
    } catch (e) {
      expect(e.message, 'error message should be equal').be.equal('JSON-RPC error: onError should be a function');
    }
  });

  it('should executeHook', async () => {
    const hook1 = (params: any, result: any) => {
      return params == result ? true : false;
    };
    const hook2 = (params: any, result: any) => {
      return result;
    };
    const hook3 = 'hello';
    const hooks: ((params: any, result: any) => boolean)[] = [];
    hooks.push(hook1);
    hooks.push(hook2);
    expect(executeHook(hook1, 1, 1), 'result should be true').be.true;
    const result = await executeHook(hooks, 1, 1);
    expect(result[0], 'function result should be equal').be.true;
    expect(result[1], 'function result should be equal').be.equal(1);
    try {
      executeHook(hook3, 1, 1);
    } catch (error) {
      expect(error.message, 'error message should be equal').be.equal('JSON-RPC error: wrong hook type passed');
    }
  });
});
