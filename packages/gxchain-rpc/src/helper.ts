import error from './error-codes';

class Errexpand extends Error {
  code: number = 0;
}

export const JSONRPC_VERSION = '2.0';

export function throwRpcErr(message = 'JSON-RPC error', code = 500) {
  const err = new Errexpand(message);
  err.code = code;
  throw err;
}

export function validateJsonRpcVersion(version: string, requiredVersion: string) {
  if (version !== requiredVersion) {
    throwRpcErr(`${error.INVALID_REQUEST.message}, wrong version - ${version}`, error.INVALID_REQUEST.code);
  }
}

/**
 * Validation for JSON-RPC method passed from browser
 * @param {string} method
 * @param {array} controller, list of existing methods
 */
export function validateJsonRpcMethod(method: string, controller: any) {
  if (!method || typeof method !== 'string') {
    throwRpcErr(`${error.INVALID_REQUEST.message}, wrong method - ${method}`, error.INVALID_REQUEST.code);
  } else if (!(method in controller)) {
    throwRpcErr(`${error.METHOD_NOT_FOUND.message} - ${method}`, error.METHOD_NOT_FOUND.code);
  }
}

/**
 * Check is value nullable.
 * @param {any} val
 * @return {boolean}
 */
export function isNil(val: any) {
  return val == null;
}

/**
 * Check is value function.
 * @param {any} fn
 * @return {boolean}
 */
export function isFunction(fn: any) {
  return typeof fn === 'function';
}
/**
 * Validate passed user config
 * @param config
 */
export function validateConfig(config: any) {
  if (typeof config !== 'object') {
    throwRpcErr('JSON-RPC error: userConfig should be an object.');
  }
  if (typeof config.methods !== 'object' || Array.isArray(config.methods)) {
    throwRpcErr('JSON-RPC error: methods should be an object');
  }
  if ('beforeMethods' in config) {
    if (typeof config.beforeMethods !== 'object' || Array.isArray(config.beforeMethods)) {
      throwRpcErr('JSON-RPC error: beforeMethods should be an object');
    }

    Object.keys(config.beforeMethods).forEach((before) => {
      if (!(before in config.methods)) {
        throwRpcErr(`JSON-RPC error: beforeMethod should have the same name as method, passed: ${before}`);
      }
    });
  }
  if ('afterMethods' in config) {
    if (typeof config.afterMethods !== 'object' || Array.isArray(config.afterMethods)) {
      throwRpcErr('JSON-RPC error: afterMethods should be an object');
    }

    Object.keys(config.afterMethods).forEach((after) => {
      if (!(after in config.methods)) {
        throwRpcErr(`JSON-RPC error: afterMethods should have the same name as method, passed: ${after}`);
      }
    });
  }
  if ('onError' in config && typeof config.onError !== 'function') {
    throwRpcErr('JSON-RPC error: onError should be a function');
  }
}

/**
 * Execute passed user hooks
 * @param {function|Array<function>} hook
 * @param {Object} params
 * @param {any} result - method execution result
 * @return {void}
 */
export function executeHook(hook: any, params: any, result: any) {
  if (isFunction(hook)) return hook(params, result);
  else if (Array.isArray(hook)) return Promise.all(hook.map((h) => h(params, result)));
  throwRpcErr('JSON-RPC error: wrong hook type passed');
}
