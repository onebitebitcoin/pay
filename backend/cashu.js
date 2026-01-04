const https = require('https');
const http = require('http');

function reqJSON(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const lib = isHttps ? https : http;
    const req = lib.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          const err = new Error(`Cashu HTTP ${status}: ${data}`);
          err.status = status;
          err.data = data;
          return reject(err);
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function getDefaultMintUrl() {
  const url = process.env.CASHU_MINT_URL || 'https://mint.minibits.cash/Bitcoin';
  return url.replace(/\/$/, '');
}

function normalizeMintUrl(url) {
  if (!url || (typeof url === 'string' && url.trim() === '')) {
    return getDefaultMintUrl();
  }
  return url.trim().replace(/\/$/, '');
}

function mintUnit() {
  // Cashu v1 API commonly requires explicit unit (e.g., 'sat') on quote endpoints
  return (process.env.CASHU_UNIT || 'sat').toLowerCase();
}

async function getInfo(mintUrl) {
  const url = normalizeMintUrl(mintUrl);
  return reqJSON(`${url}/v1/info`);
}

async function getKeys(mintUrl) {
  const url = normalizeMintUrl(mintUrl);
  const keys = await reqJSON(`${url}/v1/keys`);
  console.log('[Cashu] Mint keys response:', JSON.stringify(keys, null, 2));
  return keys;
}

async function getKeysets(mintUrl) {
  const url = normalizeMintUrl(mintUrl);
  try {
    const keysets = await reqJSON(`${url}/v1/keysets`);
    console.log('[Cashu] Mint keysets response:', JSON.stringify(keysets, null, 2));
    return keysets;
  } catch (error) {
    if (error && (error.status === 404 || error.status === 405)) {
      console.warn('[Cashu] /v1/keysets not available, falling back to /v1/keys');
      const fallback = await getKeys(url);
      return fallback?.keysets || fallback;
    }
    throw error;
  }
}

async function mintQuoteBolt11({ amount, mintUrl }) {
  const url = normalizeMintUrl(mintUrl);
  return reqJSON(`${url}/v1/mint/quote/bolt11`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: { amount, unit: mintUnit() }
  });
}

async function mintBolt11(payload, mintUrl) {
  const url = normalizeMintUrl(mintUrl);
  // Forward payload as-is to support mints requiring { quote, outputs }
  return reqJSON(`${url}/v1/mint/bolt11`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: payload
  });
}

async function meltQuoteBolt11({ invoice, request, mintUrl }) {
  const url = normalizeMintUrl(mintUrl);
  // Some mints expect field name 'request' (bolt11). Accept 'invoice' from client and map to 'request'.
  const bolt11 = request || invoice;
  return reqJSON(`${url}/v1/melt/quote/bolt11`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: { request: bolt11, unit: mintUnit() }
  });
}

async function meltBolt11(payload, mintUrl) {
  const url = normalizeMintUrl(mintUrl);
  console.log('[Cashu] Melt request to:', `${url}/v1/melt/bolt11`);
  console.log('[Cashu] Melt payload:', JSON.stringify(payload, null, 2));

  try {
    const result = await reqJSON(`${url}/v1/melt/bolt11`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: payload
    });
    console.log('[Cashu] Melt success:', result);
    return result;
  } catch (error) {
    console.error('[Cashu] Melt error:', {
      status: error.status,
      data: error.data,
      message: error.message
    });
    throw error;
  }
}

async function checkMintQuote({ quote, mintUrl }) {
  const url = normalizeMintUrl(mintUrl);
  // Try path-style first; many mints support /v1/mint/quote/bolt11/:quote
  try {
    return await reqJSON(`${url}/v1/mint/quote/bolt11/${encodeURIComponent(quote)}`);
  } catch (e) {
    // Fallback to query-style some mints use: /v1/mint/quote/bolt11?quote=...&unit=sat
    if (e && (e.status === 404 || e.status === 405)) {
      try {
        return await reqJSON(`${url}/v1/mint/quote/bolt11?quote=${encodeURIComponent(quote)}&unit=${encodeURIComponent(mintUnit())}`);
      } catch (e2) {
        // Try without unit as a last resort
        return await reqJSON(`${url}/v1/mint/quote/bolt11?quote=${encodeURIComponent(quote)}`);
      }
    }
    throw e;
  }
}

async function swap({ inputs, outputs, mintUrl }) {
  const url = normalizeMintUrl(mintUrl);
  console.log('[Cashu] Swap request to:', `${url}/v1/swap`);
  console.log('[Cashu] Swap inputs:', JSON.stringify(inputs, null, 2));
  console.log('[Cashu] Swap outputs:', JSON.stringify(outputs, null, 2));

  try {
    const result = await reqJSON(`${url}/v1/swap`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: { inputs, outputs }
    });
    console.log('[Cashu] Swap success');
    return result;
  } catch (error) {
    console.error('[Cashu] Swap error:', {
      status: error.status,
      data: error.data,
      message: error.message
    });
    throw error;
  }
}

async function checkProofsState({ proofs, mintUrl }) {
  const url = normalizeMintUrl(mintUrl);
  // Check if proofs are spent using /v1/checkstate
  // Returns { states: [{ Y: string, state: 'SPENT' | 'UNSPENT' | 'PENDING' }] }
  return reqJSON(`${url}/v1/checkstate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: { Ys: proofs.map(p => p.Y || p.C) }
  });
}

module.exports = {
  getInfo,
  getKeys,
  getKeysets,
  mintQuoteBolt11,
  mintBolt11,
  meltQuoteBolt11,
  meltBolt11,
  swap,
  checkMintQuote,
  checkProofsState,
  normalizeMintUrl,
};
