const https = require('https');
const http = require('http');

function reqJSON(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const lib = isHttps ? https : http;
    const req = lib.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          const err = new Error(`HTTP ${status}: ${data}`);
          err.status = status;
          err.data = data;
          return reject(err);
        }
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          resolve({ raw: data });
        }
      });
    });
    req.on('error', reject);
  });
}

function toMsat(sats) { return Math.round(Number(sats) * 1000); }

function normalizeAddress(address) {
  return String(address || '').trim();
}

function lnurlpUrl(address) {
  const a = normalizeAddress(address);
  const at = a.indexOf('@');
  if (at === -1) return null;
  const name = a.slice(0, at);
  const host = a.slice(at + 1);
  return `https://${host}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

function isMeaninglessCode(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^[0-9a-f]{8,}$/i.test(trimmed) || /^[0-9]{6,}$/.test(trimmed);
}

function normalizeProviderError(reason, fallback = '라이트닝 주소 제공자가 결제를 거부했습니다') {
  if (!reason) return fallback;
  const text = typeof reason === 'string' ? reason.trim() : JSON.stringify(reason);
  if (!text) return fallback;
  if (isMeaninglessCode(text)) {
    return `${fallback} (코드: ${text})`;
  }
  return `${fallback}: ${text}`;
}

async function getMeta(address) {
  const url = lnurlpUrl(address);
  if (!url) throw new Error('잘못된 라이트닝 주소');
  return reqJSON(url);
}

async function requestInvoice(address, amountSat) {
  const meta = await getMeta(address);
  const cb = meta?.callback;
  const min = Number(meta?.minSendable || 0);
  const max = Number(meta?.maxSendable || 0);
  if (!cb) throw new Error('LNURL callback 없음');
  const msat = toMsat(amountSat || 0);
  if (msat <= 0) throw new Error('금액이 필요합니다');
  if (min && msat < min) throw new Error(`최소 금액은 ${Math.ceil(min / 1000)} sats 입니다`);
  if (max && msat > max) throw new Error(`최대 금액은 ${Math.floor(max / 1000)} sats 입니다`);
  const join = cb.includes('?') ? '&' : '?';
  const url = `${cb}${join}amount=${msat}`;
  const resp = await reqJSON(url);

  if (resp?.status && String(resp.status).toUpperCase() === 'ERROR') {
    const reason = resp?.reason || resp?.error || resp?.message;
    const err = new Error(normalizeProviderError(reason));
    err.code = 'LNURL_ERROR';
    err.reason = reason;
    err.response = resp;
    throw err;
  }

  const pr = resp?.pr || resp?.payment_request || resp?.request;
  if (!pr) {
    const err = new Error('인보이스 발급 실패');
    err.response = resp;
    throw err;
  }
  return { request: pr };
}

module.exports = { requestInvoice };
