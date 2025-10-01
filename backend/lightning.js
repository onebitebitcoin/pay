const https = require('https');
const http = require('http');

function doRequest(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const lib = isHttps ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (_) {
            resolve({ raw: data });
          }
        } else {
          reject(new Error(`HTTP ${status}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

class LNbitsProvider {
  constructor({ url, apiKey }) {
    if (!url || !apiKey) throw new Error('LNbits url/apiKey required');
    this.base = url.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async getBalance() {
    const url = `${this.base}/api/v1/wallet`;
    const res = await doRequest(url, {
      method: 'GET',
      headers: { 'X-Api-Key': this.apiKey },
    });
    // balance is in msats
    const msats = res.balance || 0;
    return Math.floor(msats / 1000);
  }

  async createInvoice({ amount, memo = 'Bitcoin Store' }) {
    const url = `${this.base}/api/v1/payments`;
    const body = { out: false, amount: amount, memo };
    const res = await doRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': this.apiKey },
    }, body);
    if (!res || !res.payment_request || !res.payment_hash) {
      throw new Error('Invalid response from LNbits when creating invoice');
    }
    return {
      invoice: res.payment_request,
      paymentHash: res.payment_hash,
    };
  }

  async payInvoice({ invoice }) {
    const url = `${this.base}/api/v1/payments`;
    const body = { out: true, bolt11: invoice }; 
    const res = await doRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': this.apiKey },
    }, body);
    // LNbits returns {'payment_hash': '...'} when accepted
    if (res && res.payment_hash) {
      return { ok: true, paymentHash: res.payment_hash };
    }
    throw new Error('Payment failed');
  }
}

function makeLightningProvider() {
  const provider = (process.env.LIGHTNING_PROVIDER || 'lnbits').toLowerCase();
  if (provider === 'lnbits') {
    return new LNbitsProvider({
      url: process.env.LNBITS_URL,
      apiKey: process.env.LNBITS_API_KEY,
    });
  }
  throw new Error(`Unsupported LIGHTNING_PROVIDER: ${provider}`);
}

module.exports = { makeLightningProvider };

