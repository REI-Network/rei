import error from './errorCodes';
import { JSONRPC_VERSION } from './types';

class Errexpand extends Error {
  code: number = 0;
  rpcMessage?: string;
}

/**
 * Throw rpc error
 * @param message - RPC error message
 * @param code - RPC error code
 */
export function throwRpcErr(message = 'JSON-RPC error', code = 500) {
  const err = new Errexpand();
  err.code = code;
  err.rpcMessage = message;
  throw err;
}

/**
 * Throw not found error
 * @param method - Not found method
 */
export function throwNotFoundErr(method: string) {
  throwRpcErr(`${error.METHOD_NOT_FOUND.message} - ${method}`, error.METHOD_NOT_FOUND.code);
}

/**
 * Validate JSONRPC version
 * @param version - JSONRPC version
 */
export function validateJsonRpcVersion(version: string) {
  if (version !== JSONRPC_VERSION) {
    throwRpcErr(`${error.INVALID_REQUEST.message}, wrong version - ${version}`, error.INVALID_REQUEST.code);
  }
}

/**
 * Validate method format
 * @param method - Method
 */
export function validateJsonRpcMethod(method: string) {
  if (!method || typeof method !== 'string' || method.indexOf('_') === -1) {
    throwRpcErr(`${error.INVALID_REQUEST.message}, wrong method - ${method}`, error.INVALID_REQUEST.code);
  }
}
