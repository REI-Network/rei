import createHash from 'create-hash';
import createHmac from 'create-hmac';

/** @arg {string|Buffer} data
    @arg {string} [digest = null] - 'hex', 'binary' or 'base64'
    @return {string|Buffer} - Buffer when digest is null, or string
*/
function sha1(data, encoding) {
  return createHash('sha1').update(data).digest(encoding);
}

/** @arg {string|Buffer} data
    @arg {string} [digest = null] - 'hex', 'binary' or 'base64'
    @return {string|Buffer} - Buffer when digest is null, or string
*/
function sha256(data, encoding) {
  return createHash('sha256').update(data).digest(encoding);
}

/** @arg {string|Buffer} data
    @arg {string} [digest = null] - 'hex', 'binary' or 'base64'
    @return {string|Buffer} - Buffer when digest is null, or string
*/
function sha512(data, encoding) {
  return createHash('sha512').update(data).digest(encoding);
}

function hmacSHA256(buffer, secret) {
  return createHmac('sha256', secret).update(buffer).digest();
}

function ripemd160(data) {
  return createHash('rmd160').update(data).digest();
}

export { sha1, sha256, sha512, hmacSHA256, ripemd160 };
