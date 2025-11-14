/**
 * NUT-18: Payment Request implementation
 * https://github.com/cashubtc/nuts/blob/main/18.md
 */

import * as cbor from 'cbor-web';

/**
 * Create a payment request (NUT-18)
 * @param {Object} params
 * @param {string} params.id - Payment ID
 * @param {number} params.amount - Amount in sats
 * @param {string} params.unit - Unit (e.g., 'sat')
 * @param {boolean} params.single_use - Single use flag
 * @param {string[]} params.mints - Array of allowed mint URLs
 * @param {string} params.description - User description
 * @param {Object[]} params.transports - Array of transport objects
 * @returns {Promise<string>} - Encoded payment request (creqA...)
 */
export function createPaymentRequest({
  id,
  amount,
  unit = 'sat',
  single_use = true,
  mints,
  description = '',
  transports = []
}) {
  // Build payment request object according to NUT-18 spec
  const paymentRequest = {
    i: id,           // Payment ID
    a: amount,       // Amount
    u: unit,         // Unit
    s: single_use,   // Single use
    m: mints,        // Mints array
    d: description,  // Description
    t: transports    // Transports array
  };

  // Remove undefined fields
  Object.keys(paymentRequest).forEach(key => {
    if (paymentRequest[key] === undefined) {
      delete paymentRequest[key];
    }
  });

  // Encode to CBOR
  const cborEncoded = cbor.encode(paymentRequest);

  // Convert to base64url (URL-safe base64)
  const base64 = arrayBufferToBase64(cborEncoded);
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  // Add prefix 'creqA'
  return 'creqA' + base64url;
}

/**
 * Parse a payment request (NUT-18)
 * @param {string} encoded - Encoded payment request (creqA...)
 * @returns {Promise<Object>} - Decoded payment request
 */
export function parsePaymentRequest(encoded) {
  if (!encoded || !encoded.startsWith('creqA')) {
    throw new Error('Invalid payment request format');
  }

  // Remove prefix
  const base64url = encoded.substring(5);

  // Convert base64url to base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  // Decode base64 to ArrayBuffer
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Decode CBOR
  const decoded = cbor.decode(bytes.buffer);

  return {
    id: decoded.i,
    amount: decoded.a,
    unit: decoded.u,
    single_use: decoded.s,
    mints: decoded.m,
    description: decoded.d,
    transports: decoded.t
  };
}

/**
 * Create payment payload for sending (NUT-18)
 * @param {Object} params
 * @param {string} params.id - Payment ID
 * @param {string} params.memo - Optional memo
 * @param {string} params.mint - Mint URL
 * @param {string} params.unit - Unit
 * @param {Object[]} params.proofs - Proofs array
 * @returns {Object} - Payment payload
 */
export function createPaymentPayload({
  id,
  memo = '',
  mint,
  unit = 'sat',
  proofs
}) {
  return {
    id,
    memo,
    mint,
    unit,
    proofs
  };
}

/**
 * Helper: Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Create HTTP POST transport
 * @param {string} url - POST endpoint URL
 * @returns {Object} - Transport object
 */
export function createHttpPostTransport(url) {
  return {
    t: 'post',
    a: url,
    g: [] // Optional tags
  };
}

/**
 * Send payment via HTTP POST transport
 * @param {string} url - POST endpoint URL
 * @param {Object} payload - Payment payload
 * @returns {Promise<Response>}
 */
export async function sendPaymentViaPost(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Payment failed: ${response.statusText}`);
  }

  return response;
}
