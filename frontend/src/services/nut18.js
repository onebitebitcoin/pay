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
 * Helper: Convert Uint8Array to hex string
 */
function uint8ArrayToHex(uint8Array) {
  if (!uint8Array || !uint8Array.length) return '';
  return Array.from(uint8Array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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

/**
 * Check if a string is a Cashu token (cashuA... or cashuB...)
 * @param {string} str - String to check
 * @returns {boolean}
 */
export function isCashuToken(str) {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  return trimmed.startsWith('cashuA') || trimmed.startsWith('cashuB');
}

/**
 * Parse a Cashu token (cashuA... or cashuB...)
 * @param {string} token - Cashu token string
 * @returns {Object} - Decoded token { token: [{ mint, proofs }], memo?, unit? }
 */
export function parseCashuToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid Cashu token format');
  }

  const trimmed = token.trim();

  // Check version
  const isCashuA = trimmed.startsWith('cashuA');
  const isCashuB = trimmed.startsWith('cashuB');

  if (!isCashuA && !isCashuB) {
    throw new Error('Invalid Cashu token format - must start with cashuA or cashuB');
  }

  // Remove prefix (6 characters: "cashuA" or "cashuB")
  const base64url = trimmed.substring(6);

  // Convert base64url to base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  try {
    let decoded;

    if (isCashuA) {
      // cashuA: JSON encoding
      const jsonString = atob(base64);
      decoded = JSON.parse(jsonString);
    } else {
      // cashuB: CBOR encoding
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const cborDecoded = cbor.decode(bytes.buffer);

      console.log('CBOR decoded:', cborDecoded);
      console.log('Type:', typeof cborDecoded);
      console.log('Keys:', Object.keys(cborDecoded || {}));

      // cashuB format: { m: mint_url, u: unit, t: [{ i: keyset_id, p: [proofs] }], d: memo? }
      // The mint URL is at the top level, not in each token entry
      const topLevelMint = cborDecoded.m;
      const tokenEntries = cborDecoded.t || cborDecoded.token || [];

      // Add mint URL to each token entry since cashuB stores it at top level
      const tokenWithMint = tokenEntries.map(entry => ({
        mint: topLevelMint,  // Add top-level mint to each entry
        proofs: entry.p || entry.proofs,
        id: entry.i || entry.id
      }));

      decoded = {
        token: tokenWithMint,
        memo: cborDecoded.d || '',  // 'd' is description/memo in cashuB
        unit: cborDecoded.u || cborDecoded.unit || 'sat'
      };

      console.log('Converted decoded:', decoded);
    }

    // Validate structure
    if (!decoded || !Array.isArray(decoded.token)) {
      console.error('Invalid token structure. decoded:', decoded);
      throw new Error('Invalid token structure');
    }

    return decoded;
  } catch (error) {
    throw new Error(`Failed to parse Cashu token: ${error.message}`);
  }
}

/**
 * Extract proofs from a parsed Cashu token
 * @param {Object} parsedToken - Parsed token from parseCashuToken
 * @returns {Object} - { proofs: [], totalAmount: number, mint: string }
 */
export function extractProofsFromToken(parsedToken) {
  if (!parsedToken || !Array.isArray(parsedToken.token)) {
    throw new Error('Invalid parsed token');
  }

  let allProofs = [];
  let totalAmount = 0;
  let mint = '';

  for (const entry of parsedToken.token) {
    // Support both compact (cashuB) and full (cashuA) keys
    const entryMint = entry.m || entry.mint;
    const entryProofs = entry.p || entry.proofs;

    console.log('Entry:', entry);
    console.log('Entry mint:', entryMint);
    console.log('Entry proofs:', entryProofs);

    if (!entryMint || !Array.isArray(entryProofs)) {
      console.warn('Skipping entry without mint or proofs:', entry);
      continue;
    }

    mint = mint || entryMint; // Use first mint URL

    // Convert proofs from compact to full format if needed
    const normalizedProofs = entryProofs.map(proof => {
      // If already in full format, return as-is
      if (proof.amount !== undefined && proof.secret !== undefined && proof.C && typeof proof.C === 'string') {
        return proof;
      }

      // Convert from compact format (cashuB)
      // cashuB uses: { a: amount, s: secret, c: Uint8Array(commitment), d: DLEQ }
      const normalized = {
        amount: proof.a || proof.amount,   // amount
        secret: proof.s || proof.secret,   // secret
        C: proof.C || (proof.c ? uint8ArrayToHex(proof.c) : undefined)  // commitment
      };

      // Add id if present (convert Uint8Array to hex)
      if (proof.i) {
        normalized.id = uint8ArrayToHex(proof.i);
      } else if (proof.id) {
        normalized.id = typeof proof.id === 'string' ? proof.id : uint8ArrayToHex(proof.id);
      }

      // Add DLEQ witness if present (convert to JSON string as per Cashu spec)
      if (proof.d) {
        // cashuB: DLEQ proof as object with Uint8Array fields
        normalized.witness = JSON.stringify({
          e: uint8ArrayToHex(proof.d.e),
          s: uint8ArrayToHex(proof.d.s),
          r: uint8ArrayToHex(proof.d.r)
        });
      } else if (proof.witness) {
        // Already in witness format - ensure it's a string
        normalized.witness = typeof proof.witness === 'string' ? proof.witness : JSON.stringify(proof.witness);
      }

      return normalized;
    });

    allProofs = allProofs.concat(normalizedProofs);

    for (const proof of normalizedProofs) {
      totalAmount += Number(proof.amount || 0);
    }
  }

  console.log('Extracted proofs:', allProofs);
  console.log('Total amount:', totalAmount);
  console.log('Mint:', mint);

  return {
    proofs: allProofs,
    totalAmount,
    mint,
    memo: parsedToken.memo || '',
    unit: parsedToken.unit || 'sat'
  };
}

/**
 * Create a Cashu token (cashuA...) from proofs.
 * Accepts either a single mint/proofs pair or an array of entries with different mints.
 * @param {Object} params
 * @param {string} [params.mint] - Mint URL for single entry shortcut
 * @param {Object[]} [params.proofs] - Proofs for single entry shortcut
 * @param {Array<{mint: string, proofs: Object[]}>} [params.entries] - Multiple token entries
 * @param {string} [params.memo] - Optional memo/description
 * @param {string} [params.unit='sat'] - Unit label
 * @returns {string} Encoded Cashu token string
 */
export function createCashuToken({ mint, proofs, entries, memo = '', unit = 'sat' }) {
  const tokenEntries = [];

  if (Array.isArray(entries) && entries.length > 0) {
    for (const entry of entries) {
      if (!entry?.mint || !Array.isArray(entry.proofs) || entry.proofs.length === 0) continue;
      tokenEntries.push({
        mint: entry.mint,
        proofs: sanitizeProofs(entry.proofs)
      });
    }
  } else if (mint && Array.isArray(proofs) && proofs.length > 0) {
    tokenEntries.push({
      mint,
      proofs: sanitizeProofs(proofs)
    });
  }

  if (!tokenEntries.length) {
    throw new Error('No proofs available to create token');
  }

  const payload = {
    token: tokenEntries,
    unit
  };

  if (memo && memo.trim()) {
    payload.memo = memo.trim();
  }

  const jsonString = JSON.stringify(payload);
  const base64 = btoa(jsonString);
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return 'cashuA' + base64url;
}

function sanitizeProofs(list) {
  return list
    .map((proof) => {
      if (!proof) return null;
      if (!proof.amount || !proof.secret || !proof.C) return null;

      const sanitized = {
        amount: Number(proof.amount),
        secret: proof.secret,
        C: proof.C
      };

      if (proof.id) {
        sanitized.id = proof.id;
      }

      if (proof.witness) {
        sanitized.witness = typeof proof.witness === 'object'
          ? JSON.stringify(proof.witness)
          : proof.witness;
      } else if (proof.dleq) {
        sanitized.witness = typeof proof.dleq === 'object'
          ? JSON.stringify(proof.dleq)
          : proof.dleq;
      }

      return sanitized;
    })
    .filter(Boolean);
}
