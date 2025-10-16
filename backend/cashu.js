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
  return reqJSON(`${url}/v1/keys`);
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
  return reqJSON(`${url}/v1/melt/bolt11`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: payload
  });
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
  return reqJSON(`${url}/v1/swap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: { inputs, outputs }
  });
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
  mintQuoteBolt11,
  mintBolt11,
  meltQuoteBolt11,
  meltBolt11,
  swap,
  checkMintQuote,
  checkProofsState,
};
