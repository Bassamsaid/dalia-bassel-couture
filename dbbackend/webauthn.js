'use strict';
// Face ID and fingerprint sign-in, checked here.
//
// The phone never sends a face. It checks the face itself, and only then uses a
// key it made for this site and kept in its secure hardware to sign a one-time
// challenge. This file makes the challenge and checks the signature — so what
// the studio stores is a public key, which is worth nothing to anyone who steals
// it. That is the whole appeal over a password.
//
// Written against the W3C Web Authentication spec with nothing installed: a
// small CBOR reader for the two structures the browser sends, and node:crypto
// for the rest.
const crypto = require('node:crypto');

// ---- base64url, which is what the browser speaks ----
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(String(s || ''), 'base64url');

// ---- CBOR, only as much as WebAuthn uses ----
// Enough for the attestation object and a COSE key: integers, byte and text
// strings, arrays, maps, the simple values, and tags (read and ignored).
function cbor(buf, at = 0) {
  const b = buf[at];
  if (b === undefined) throw new Error('CBOR ended early');
  const major = b >> 5;
  const minor = b & 31;
  let len = minor;
  let i = at + 1;
  if (minor === 24) { len = buf.readUInt8(i); i += 1; }
  else if (minor === 25) { len = buf.readUInt16BE(i); i += 2; }
  else if (minor === 26) { len = buf.readUInt32BE(i); i += 4; }
  else if (minor === 27) { len = Number(buf.readBigUInt64BE(i)); i += 8; }
  else if (minor > 27) throw new Error('CBOR: reserved length');

  switch (major) {
    case 0: return [len, i];                       // unsigned
    case 1: return [-1 - len, i];                  // negative
    case 2: return [buf.subarray(i, i + len), i + len];               // bytes
    case 3: return [buf.subarray(i, i + len).toString('utf8'), i + len]; // text
    case 4: {                                      // array
      const out = [];
      for (let n = 0; n < len; n++) { const [v, j] = cbor(buf, i); out.push(v); i = j; }
      return [out, i];
    }
    case 5: {                                      // map
      const out = new Map();
      for (let n = 0; n < len; n++) {
        const [k, j] = cbor(buf, i);
        const [v, j2] = cbor(buf, j);
        out.set(k, v); i = j2;
      }
      return [out, i];
    }
    case 6: return cbor(buf, i);                   // tag: the value is what matters
    case 7:                                        // simple / float
      if (minor === 20) return [false, i];
      if (minor === 21) return [true, i];
      if (minor === 22) return [null, i];
      if (minor === 23) return [undefined, i];
      if (minor === 25) return [buf.readFloatBE(i - 2), i];
      if (minor === 26) return [buf.readFloatBE(i - 4), i];
      if (minor === 27) return [buf.readDoubleBE(i - 8), i];
      return [len, i];
    default: throw new Error('CBOR: unknown type');
  }
}
const decodeCbor = (buf) => cbor(buf, 0)[0];

// ---- the authenticator's own statement about what just happened ----
// rpIdHash(32) · flags(1) · signCount(4) · [credential] · [extensions]
function readAuthData(buf) {
  if (buf.length < 37) throw new Error('Authenticator data is too short');
  const flags = buf[32];
  const out = {
    rpIdHash: buf.subarray(0, 32),
    flags,
    userPresent: !!(flags & 0x01),   // somebody touched it
    userVerified: !!(flags & 0x04),  // ...and the device recognised them
    signCount: buf.readUInt32BE(33),
  };
  if (flags & 0x40) { // a new credential is attached
    const idLen = buf.readUInt16BE(53);
    out.credentialId = buf.subarray(55, 55 + idLen);
    out.coseKey = decodeCbor(buf.subarray(55 + idLen));
  }
  return out;
}

// ---- COSE key → JWK, so node:crypto can take it ----
// Only the two algorithms a phone or laptop actually offers.
function coseToJwk(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2) { // elliptic curve
    if (alg !== -7) throw new Error('Unsupported key algorithm');
    if (cose.get(-1) !== 1) throw new Error('Unsupported curve');
    return { kty: 'EC', crv: 'P-256', x: b64url(cose.get(-2)), y: b64url(cose.get(-3)) };
  }
  if (kty === 3) { // RSA
    if (alg !== -257) throw new Error('Unsupported key algorithm');
    return { kty: 'RSA', n: b64url(cose.get(-1)), e: b64url(cose.get(-2)) };
  }
  throw new Error('Unsupported key type');
}

function verifySignature(jwk, signed, signature) {
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return crypto.verify('sha256', signed, key, signature);
}

// ---- what the browser was told about the page it signed for ----
function readClientData(b64, { expectType, expectChallenge, origins }) {
  let data;
  try { data = JSON.parse(fromB64url(b64).toString('utf8')); }
  catch (e) { throw new Error('The browser sent something unreadable.'); }
  if (data.type !== expectType) throw new Error('This signature was made for something else.');
  // Compared as bytes, and in constant time: the challenge is the one thing
  // standing between a replayed signature and a session.
  const got = fromB64url(data.challenge);
  const want = Buffer.from(expectChallenge, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    throw new Error('That sign-in attempt has expired. Try again.');
  }
  if (!origins.includes(data.origin)) throw new Error('This signature came from another site.');
  return data;
}

const newChallenge = () => crypto.randomBytes(32).toString('base64url');

// ---- registering a new face/finger on a device ----
function verifyRegistration({ response, challenge, rpId, origins }) {
  readClientData(response.clientDataJSON, { expectType: 'webauthn.create', expectChallenge: challenge, origins });
  const att = decodeCbor(fromB64url(response.attestationObject));
  const auth = readAuthData(att.get('authData'));
  if (!auth.userPresent) throw new Error('The device did not confirm anyone was there.');
  if (!auth.credentialId) throw new Error('The device sent no credential.');
  if (!auth.rpIdHash.equals(crypto.createHash('sha256').update(rpId).digest())) {
    throw new Error('This credential was made for another site.');
  }
  // The attestation statement says which make of device this is. The studio has
  // no reason to care, and asking for it would mean a certificate chain to keep
  // current, so it is not checked — only that the key itself is sound.
  return {
    credentialId: b64url(auth.credentialId),
    jwk: coseToJwk(auth.coseKey),
    signCount: auth.signCount,
    userVerified: auth.userVerified,
  };
}

// ---- signing in with one ----
function verifyAssertion({ response, challenge, rpId, origins, jwk, storedCount }) {
  readClientData(response.clientDataJSON, { expectType: 'webauthn.get', expectChallenge: challenge, origins });
  const authBytes = fromB64url(response.authenticatorData);
  const auth = readAuthData(authBytes);
  if (!auth.rpIdHash.equals(crypto.createHash('sha256').update(rpId).digest())) {
    throw new Error('This key belongs to another site.');
  }
  if (!auth.userPresent) throw new Error('The device did not confirm anyone was there.');
  if (!auth.userVerified) throw new Error('The device did not recognise you. Use your password instead.');
  const signed = Buffer.concat([authBytes, crypto.createHash('sha256').update(fromB64url(response.clientDataJSON)).digest()]);
  if (!verifySignature(jwk, signed, fromB64url(response.signature))) {
    throw new Error('That signature did not check out.');
  }
  // A counter that goes backwards means two things are answering for one key —
  // the spec's one hint that a credential has been copied. Authenticators that
  // keep no counter report zero forever, which is not a warning.
  if (auth.signCount > 0 && storedCount > 0 && auth.signCount <= storedCount) {
    throw new Error('This key looks like a copy. Use your password and set it up again.');
  }
  return { signCount: auth.signCount };
}

module.exports = { newChallenge, verifyRegistration, verifyAssertion, decodeCbor, readAuthData, coseToJwk, b64url };
