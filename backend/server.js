const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
require('dotenv').config();

// Disable console logs in production (keep error and warn)
if (process.env.NODE_ENV === 'production') {
  console.log = function() {};
  console.info = function() {};
  console.debug = function() {};
}

const db = require('./db');
const cashu = require('./cashu');
const lnaddr = require('./lightningaddr');

const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const subscriptions = new Map(); // subscriptionId -> ws
const quoteToSubscription = new Map(); // quoteId -> subscriptionId for payment notifications
const PORT = process.env.PORT || 5001;

/**
 * Lightweight helper to fetch JSON over HTTPS without adding extra deps.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
function fetchJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      let rawData = '';

      response.on('data', (chunk) => {
        rawData += chunk;
      });

      response.on('end', () => {
        if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
          return reject(new Error(`Request failed with status ${response.statusCode}`));
        }

        try {
          const parsed = JSON.parse(rawData);
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Request timed out'));
    });
  });
}

// Generate unique subscription ID using SHA256
function generateSubscriptionId() {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(timestamp + randomBytes).digest('hex');
  return hash;
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  // Generate unique subscription ID for this connection
  const subscriptionId = generateSubscriptionId();
  subscriptions.set(subscriptionId, ws);
  ws.subscriptionId = subscriptionId;

  console.log(`Client connected to WebSocket with subscriptionId: ${subscriptionId}`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received WebSocket message:', data);

      // Handle test ping messages
      if (data.type === 'ping') {
        const targetSubscriptionId = data.subscriptionId;

        if (targetSubscriptionId) {
          // Send to specific subscription (like push notification)
          const targetClient = subscriptions.get(targetSubscriptionId);
          if (targetClient && targetClient.readyState === WebSocket.OPEN) {
            targetClient.send(JSON.stringify({
              type: 'pong',
              timestamp: Date.now(),
              subscriptionId: targetSubscriptionId,
              message: 'Response sent to subscribed client',
              originalMessage: data
            }));
            console.log(`Sent pong to subscriptionId: ${targetSubscriptionId}`);
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              error: `No active subscription found for subscriptionId: ${targetSubscriptionId}`,
              subscriptionId: targetSubscriptionId
            }));
            console.log(`No subscriber found for subscriptionId: ${targetSubscriptionId}`);
          }
        } else {
          // No subscriptionId - send to current client only
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now(),
            message: 'Direct response (no subscription)',
            originalMessage: data
          }));
          console.log('Sent direct pong response');
        }
        return;
      }

      // Handle subscription info request
      if (data.type === 'getSubscriptionInfo') {
        ws.send(JSON.stringify({
          type: 'subscriptionInfo',
          subscriptionId: ws.subscriptionId,
          totalActive: subscriptions.size
        }));
        console.log(`Sent subscription info to ${ws.subscriptionId}`);
        return;
      }

      // Handle quote subscription (for payment notifications)
      if (data.type === 'subscribeQuote' && data.quoteId) {
        quoteToSubscription.set(data.quoteId, ws.subscriptionId);
        console.log(`Linked quoteId ${data.quoteId} to subscriptionId ${ws.subscriptionId}`);

        // Send confirmation
        ws.send(JSON.stringify({
          type: 'quoteSubscribed',
          quoteId: data.quoteId,
          subscriptionId: ws.subscriptionId
        }));
      }

      // Handle quote unsubscribe
      if (data.type === 'unsubscribeQuote' && data.quoteId) {
        const removed = quoteToSubscription.delete(data.quoteId);
        console.log(`Unlinked quoteId ${data.quoteId} - ${removed ? 'success' : 'not found'}`);

        // Send confirmation
        ws.send(JSON.stringify({
          type: 'quoteUnsubscribed',
          quoteId: data.quoteId,
          success: removed
        }));
      }
    } catch (e) {
      console.error('Invalid WebSocket message:', e);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format',
        message: e.message
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected from WebSocket: ${ws.subscriptionId}`);
    // Clean up subscriptions
    subscriptions.delete(ws.subscriptionId);

    // Clean up quote subscriptions
    for (const [quoteId, subId] of quoteToSubscription.entries()) {
      if (subId === ws.subscriptionId) {
        quoteToSubscription.delete(quoteId);
      }
    }
  });

  // Send connection confirmation with subscriptionId
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'WebSocket connection established',
    subscriptionId: ws.subscriptionId
  }));
});

// Send a notification to a specific client subscribed to a quote
function sendPaymentNotification(quoteId, data) {
  const subscriptionId = quoteToSubscription.get(quoteId);
  if (subscriptionId) {
    const ws = subscriptions.get(subscriptionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'payment_received',
        ...data
      }));
      // Once notified, remove the quote subscription
      quoteToSubscription.delete(quoteId);
      console.log(`Sent payment notification for quote ${quoteId} to subscription ${subscriptionId}`);
    } else {
      console.log(`No active WebSocket found for subscription ${subscriptionId}`);
      quoteToSubscription.delete(quoteId);
    }
  } else {
    console.log(`No subscription found for quote ${quoteId}`);
  }
}

// Store active quotes being monitored and cache redeemed signatures briefly
const activeQuotes = new Map();
const redeemedQuotes = new Map();

// Store eCash request signatures: requestId -> { signatures, amount, timestamp }
const ecashRequestSignatures = new Map();

function cacheRedeemedQuote(quoteId, data) {
  redeemedQuotes.set(quoteId, data);
  setTimeout(() => {
    if (redeemedQuotes.get(quoteId) === data) {
      redeemedQuotes.delete(quoteId);
    }
  }, 10 * 60 * 1000); // keep for 10 minutes
}

// Monitor quote status and auto-redeem when paid
async function monitorQuote(quoteId, amount, outputs, outputDatas, mintKeys, mintUrl) {
  const maxAttempts = 60; // 2 minutes at 2s interval
  let attempts = 0;

  const checkInterval = setInterval(async () => {
    try {
      attempts++;

      // Check if quote still exists in active quotes
      if (!activeQuotes.has(quoteId)) {
        clearInterval(checkInterval);
        return;
      }

      // Check quote state
      const checkResp = await cashu.checkMintQuote({ quote: quoteId, mintUrl });
      const state = (checkResp?.state || '').toUpperCase();

      if (state === 'PAID' || state === 'ISSUED') {
        // Quote is paid, proceed with redemption
        try {
          const redeemResult = await cashu.mintBolt11({ quote: quoteId, outputs }, mintUrl);
          const signatures = redeemResult?.signatures || redeemResult?.promises || [];

          if (Array.isArray(signatures) && signatures.length > 0) {
            const totalAmount = signatures.reduce((sum, sig) => {
              return sum + (parseInt(sig?.amount, 10) || 0);
            }, 0);

            const mintedAt = new Date().toISOString();
            const redeemPayload = {
              quote: quoteId,
              amount: totalAmount,
              signatures,
              keysetId: redeemResult?.keyset_id || redeemResult?.keysetId || null,
              timestamp: mintedAt,
            };

            cacheRedeemedQuote(quoteId, redeemPayload);

            // Broadcast payment notification
            sendPaymentNotification(quoteId, redeemPayload);

            console.log(`Payment auto-redeemed: ${totalAmount} sats for quote ${quoteId}`);

            // Remove from active quotes
            activeQuotes.delete(quoteId);
            clearInterval(checkInterval);
          }
        } catch (redeemError) {
          console.error('Auto-redeem failed:', redeemError);
          // Keep monitoring in case it was a temporary error
        }
      } else if (attempts >= maxAttempts) {
        // Timeout - stop monitoring
        console.log(`Quote ${quoteId} monitoring timeout after ${maxAttempts} attempts`);
        activeQuotes.delete(quoteId);
        clearInterval(checkInterval);
      }
    } catch (error) {
      console.error('Quote monitoring error:', error);
      // Continue monitoring despite errors
    }
  }, 2000); // Check every 2 seconds

  // Store the interval ID so it can be cancelled if needed
  activeQuotes.set(quoteId, { checkInterval, amount, createdAt: Date.now() });
}

app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://pay.onebitebitcoin.com'],
  credentials: true
}));
app.use(express.json());

// Seed data (used when no DB present) - kept for initial file
const seedStores = [
  {
    id: 1,
    name: "강남 비트코인 카페",
    category: "카페",
    address: "서울특별시 강남구 테헤란로 123",
    lat: 37.4979,
    lng: 127.0276
  },
  {
    id: 2,
    name: "홍대 크립토 버거",
    category: "음식점", 
    address: "서울특별시 마포구 홍익로 456",
    lat: 37.5565,
    lng: 126.9240
  },
  {
    id: 3,
    name: "명동 디지털 전자상가",
    category: "전자제품",
    address: "서울특별시 중구 명동길 789",
    lat: 37.5636,
    lng: 126.9834
  },
  {
    id: 4,
    name: "이태원 블록체인 서점",
    category: "서점",
    address: "서울특별시 용산구 이태원로 321",
    lat: 37.5347,
    lng: 126.9947
  },
  {
    id: 5,
    name: "강남역 사토시 초밥",
    category: "음식점",
    address: "서울특별시 강남구 강남대로 654",
    lat: 37.4980,
    lng: 127.0276
  },
  {
    id: 6,
    name: "중구 비트호텔",
    category: "호텔",
    address: "서울특별시 중구 세종대로 987",
    lat: 37.5665,
    lng: 126.9780
  },
  {
    id: 7,
    name: "신촌 코인마트",
    category: "편의점",
    address: "서울특별시 서대문구 신촌로 147",
    lat: 37.5589,
    lng: 126.9368
  },
  {
    id: 8,
    name: "압구정 디지털 델리",
    category: "델리",
    address: "서울특별시 강남구 압구정로 258",
    lat: 37.5206,
    lng: 127.0230
  },
  {
    id: 9,
    name: "여의도 코인 피자",
    category: "피자",
    address: "서울특별시 영등포구 여의도동 369",
    lat: 37.5219,
    lng: 126.9245
  },
  {
    id: 10,
    name: "잠실 블록체인 헤어샵",
    category: "미용실",
    address: "서울특별시 송파구 잠실동 741",
    lat: 37.5133,
    lng: 127.1000
  },
  {
    id: 11,
    name: "마포 디지털 체육관",
    category: "헬스장",
    address: "서울특별시 마포구 마포대로 852",
    lat: 37.5663,
    lng: 126.9019
  },
  {
    id: 12,
    name: "서초 코인 자동차정비",
    category: "자동차정비",
    address: "서울특별시 서초구 서초대로 963",
    lat: 37.4837,
    lng: 127.0324
  },
  {
    id: 13,
    name: "동작 비트코인 세탁소",
    category: "세탁소",
    address: "서울특별시 동작구 동작대로 159",
    lat: 37.5124,
    lng: 126.9393
  },
  {
    id: 14,
    name: "성동 디지털 약국",
    category: "약국",
    address: "서울특별시 성동구 왕십리로 357",
    lat: 37.5506,
    lng: 127.0409
  },
  {
    id: 15,
    name: "노원 블록체인 철물점",
    category: "철물점",
    address: "서울특별시 노원구 노원로 486",
    lat: 37.6544,
    lng: 127.0568
  }
];

const getRandomStores = (stores, count = 8) => {
  const shuffled = [...stores].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

app.get('/api/stores', (req, res) => {
  try {
    const stores = db.list();
    res.json(stores);
  } catch (error) {
    res.status(500).json({ error: '서버 내부 오류' });
  }
});

app.get('/api/stores/random', (req, res) => {
  try {
    const count = parseInt(req.query.count) || 8;
    const randomStores = db.random(count);
    res.json(randomStores);
  } catch (error) {
    res.status(500).json({ error: '서버 내부 오류' });
  }
});

app.get('/api/stores/search', (req, res) => {
  try {
    const { q } = req.query;
    const results = db.search(q || '');
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: '서버 내부 오류' });
  }
});

app.get('/api/stores/:id', (req, res) => {
  try {
    const storeId = parseInt(req.params.id);
    const store = db.get(storeId);
    
    if (!store) {
      return res.status(404).json({ error: '매장을 찾을 수 없습니다' });
    }

    res.json(store);
  } catch (error) {
    res.status(500).json({ error: '서버 내부 오류' });
  }
});

app.get('/api/rates/krw-btc', async (req, res) => {
  try {
    const data = await fetchJson('https://api.upbit.com/v1/ticker?markets=KRW-BTC');
    const tradePrice = Number(data?.[0]?.trade_price);

    if (!Number.isFinite(tradePrice)) {
      throw new Error('Invalid trade price from Upbit');
    }

    res.json({
      rate: tradePrice,
      currency: 'KRW',
      market: 'KRW-BTC',
      source: 'upbit',
      fetchedAt: Date.now()
    });
  } catch (error) {
    console.error('[Rates] Failed to fetch Upbit KRW rate:', error);
    res.status(502).json({ error: 'Failed to fetch rate from Upbit' });
  }
});

// Add a new store
app.post('/api/stores', (req, res) => {
  try {
    const {
      name,
      category,
      address,
      address_detail = null,
      lat,
      lng,
      phone = null,
      hours = null,
      description = null,
      website = null,
      naver_map_url = null,
    } = req.body || {};
    const parsedLat = typeof lat === 'string' ? parseFloat(lat) : lat;
    const parsedLng = typeof lng === 'string' ? parseFloat(lng) : lng;
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedCategory = typeof category === 'string' ? category.trim() : '';
    const trimmedAddress = typeof address === 'string' ? address.trim() : '';
    if (
      !trimmedName ||
      !trimmedCategory ||
      !trimmedAddress ||
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLng)
    ) {
      return res.status(400).json({ error: '유효하지 않은 입력입니다. name, category, address, lat, lng 필수' });
    }
    const created = db.add({
      name: trimmedName,
      category: trimmedCategory,
      address: trimmedAddress,
      address_detail: address_detail ? String(address_detail).trim() : null,
      lat: parsedLat,
      lng: parsedLng,
      phone: phone ? String(phone).trim() : null,
      hours: hours ? String(hours).trim() : null,
      description: description ? String(description).trim() : null,
      website: website ? String(website).trim() : null,
      naver_map_url: naver_map_url ? String(naver_map_url).trim() : null,
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('매장 추가 오류:', error);
    res.status(500).json({ error: '서버 내부 오류' });
  }
});

app.put('/api/stores/:id', (req, res) => {
  try {
    const storeId = parseInt(req.params.id, 10);
    if (!Number.isInteger(storeId)) {
      return res.status(400).json({ error: '유효한 매장 ID가 필요합니다' });
    }

    const existing = db.get(storeId);
    if (!existing) {
      return res.status(404).json({ error: '매장을 찾을 수 없습니다' });
    }

    const {
      name,
      category,
      address,
      address_detail,
      lat,
      lng,
      phone,
      hours,
      description,
      website,
      name_en,
      address_en,
      category_en,
      naver_map_url,
    } = req.body || {};

    const nextName = typeof name === 'string' ? name.trim() : existing.name;
    const nextCategory = typeof category === 'string' ? category.trim() : existing.category;
    const nextAddress = typeof address === 'string' ? address.trim() : existing.address;
    const nextLat = lat !== undefined ? parseFloat(lat) : existing.lat;
    const nextLng = lng !== undefined ? parseFloat(lng) : existing.lng;

    if (
      !nextName ||
      !nextCategory ||
      !nextAddress ||
      !Number.isFinite(nextLat) ||
      !Number.isFinite(nextLng)
    ) {
      return res.status(400).json({ error: '유효하지 않은 입력입니다. name, category, address, lat, lng 필수' });
    }

    const updated = db.update(storeId, {
      name: nextName,
      category: nextCategory,
      address: nextAddress,
      address_detail: address_detail !== undefined ? (address_detail ? String(address_detail).trim() : null) : existing.address_detail,
      lat: nextLat,
      lng: nextLng,
      phone: phone !== undefined ? (phone ? String(phone).trim() : null) : existing.phone,
      hours: hours !== undefined ? (hours ? String(hours).trim() : null) : existing.hours,
      description: description !== undefined ? (description ? String(description).trim() : null) : existing.description,
      website: website !== undefined ? (website ? String(website).trim() : null) : existing.website,
      name_en: name_en !== undefined ? (name_en ? String(name_en).trim() : null) : existing.name_en,
      address_en: address_en !== undefined ? (address_en ? String(address_en).trim() : null) : existing.address_en,
      category_en: category_en !== undefined ? (category_en ? String(category_en).trim() : null) : existing.category_en,
      naver_map_url: naver_map_url !== undefined ? (naver_map_url ? String(naver_map_url).trim() : null) : existing.naver_map_url,
    });

    res.json(updated);
  } catch (error) {
    console.error('매장 업데이트 오류:', error);
    res.status(500).json({ error: '서버 내부 오류' });
  }
});

app.delete('/api/stores/:id', (req, res) => {
  try {
    const storeId = parseInt(req.params.id, 10);
    if (!Number.isInteger(storeId)) {
      return res.status(400).json({ error: '유효한 매장 ID가 필요합니다' });
    }

    const removed = db.remove(storeId);
    if (!removed) {
      return res.status(404).json({ error: '매장을 찾을 수 없습니다' });
    }

    return res.status(204).send();
  } catch (error) {
    console.error('매장 삭제 오류:', error);
    res.status(500).json({ error: '서버 내부 오류' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: '정상', timestamp: new Date().toISOString() });
});

// Lightning routes removed - using Cashu only


// Cashu Mint proxy (uses client-provided mintUrl or fallback to env). Minimal subset for LN mint/melt.
app.get('/api/cashu/info', async (req, res) => {
  try {
    const mintUrl = req.query.mintUrl;
    res.json(await cashu.getInfo(mintUrl));
  } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.get('/api/cashu/keys', async (req, res) => {
  try {
    const mintUrl = req.query.mintUrl;
    res.json(await cashu.getKeys(mintUrl));
  } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.post('/api/cashu/mint/quote', async (req, res) => {
  try {
    const { amount, outputs, mintUrl } = req.body || {};
    console.log('Quote request received:', { amount, hasOutputs: !!outputs, outputsLength: outputs?.length, mintUrl });

    if (!amount || amount <= 0) return res.status(400).json({ error: 'amount 필요' });
    const out = await cashu.mintQuoteBolt11({ amount: parseInt(amount, 10), mintUrl });

    // If client provides outputs, start server-side monitoring
    const quoteId = out?.quote || out?.quote_id;
    console.log('Quote created:', { quoteId, hasOutputs: !!outputs });

    if (quoteId && outputs && Array.isArray(outputs) && outputs.length > 0) {
      // Get mint keys for monitoring
      const mintKeys = await cashu.getKeys(mintUrl);
      monitorQuote(quoteId, parseInt(amount, 10), outputs, null, mintKeys, mintUrl);
      console.log(`✓ Started monitoring quote: ${quoteId} with ${outputs.length} outputs`);
    } else {
      console.log(`✗ NOT monitoring quote ${quoteId} - missing outputs or invalid`);
    }

    res.json(out);
  } catch (e) {
    console.error('Quote creation error:', e);
    // Try to parse error data if it's a JSON string
    let errorResponse = { error: e.message };
    if (e.data) {
      try {
        const parsed = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        errorResponse = parsed;
      } catch {
        errorResponse = { error: e.data };
      }
    }
    res.status(e.status || 500).json(errorResponse);
  }
});

app.get('/api/cashu/mint/quote/check', async (req, res) => {
  try {
    const quote = req.query.quote;
    const mintUrl = req.query.mintUrl;
    if (!quote) return res.status(400).json({ error: 'quote 필요' });
    const out = await cashu.checkMintQuote({ quote, mintUrl });
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.get('/api/cashu/mint/result', (req, res) => {
  const quote = req.query.quote;
  if (!quote) {
    return res.status(400).json({ error: 'quote 필요' });
  }
  const data = redeemedQuotes.get(quote);
  if (!data) {
    return res.status(404).json({ error: '결제 결과를 찾을 수 없습니다' });
  }
  res.json(data);
});

app.post('/api/cashu/mint/redeem', async (req, res) => {
  try {
    const { quote, outputs, mintUrl } = req.body || {};
    if (!quote) return res.status(400).json({ error: 'quote 필요' });
    if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
      return res.status(400).json({ error: 'outputs 배열 필요 (블라인드 출력)' });
    }
    // Forward full payload to support mints that require additional fields
    const out = await cashu.mintBolt11(req.body, mintUrl);

    // Note: WebSocket notifications are now handled by server-side monitoring
    // This endpoint is kept for backwards compatibility or manual redemption

    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.post('/api/cashu/melt/quote', async (req, res) => {
  try {
    const { invoice, request, mintUrl } = req.body || {};
    let bolt11 = (request || invoice || '').toString().trim();
    if (bolt11.toLowerCase().startsWith('lightning:')) {
      bolt11 = bolt11.slice('lightning:'.length);
    }
    if (!bolt11) return res.status(400).json({ error: 'request 필요' });
    const out = await cashu.meltQuoteBolt11({ request: bolt11, mintUrl });
    res.json(out);
  } catch (e) {
    // Try to parse and clean up error message from mint server
    let errorMsg = e.data || e.message;
    let errorCode = e.code || e.status;

    // If error data is a JSON string, try to parse it
    if (typeof errorMsg === 'string') {
      try {
        const parsed = JSON.parse(errorMsg);
        if (parsed.detail) {
          errorMsg = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
        } else if (parsed.message) {
          errorMsg = parsed.message;
        } else if (parsed.error) {
          errorMsg = parsed.error;
        }
        if (parsed.code) errorCode = parsed.code;
      } catch {
        // If parsing fails, use the original string
      }
    }

    // Check if error message is meaningless (hex string, very short, etc.)
    const isMeaningless = typeof errorMsg === 'string' && (
      /^[0-9a-f]{8,}$/i.test(errorMsg.trim()) || // Hex string
      errorMsg.trim().length < 3 || // Too short
      /^[0-9]+$/.test(errorMsg.trim()) // Just numbers
    );

    // Use a default message if the error is meaningless
    if (isMeaningless) {
      errorMsg = '유효하지 않은 인보이스입니다';
    }

    const response = { error: errorMsg };
    if (errorCode) response.code = errorCode;

    console.error('Melt quote error:', { originalError: e.data || e.message, code: errorCode, sentToClient: errorMsg });
    res.status(e.status || 500).json(response);
  }
});

app.post('/api/cashu/melt', async (req, res) => {
  try {
    const { quote, inputs, proofs, mintUrl } = req.body || {};
    if (!quote) return res.status(400).json({ error: 'quote 필요' });
    if ((!inputs || !Array.isArray(inputs)) && (!proofs || !Array.isArray(proofs))) {
      return res.status(400).json({ error: 'inputs 또는 proofs 배열 필요' });
    }
    const out = await cashu.meltBolt11(req.body, mintUrl);
    res.json(out);
  } catch (e) {
    // Try to parse and clean up error message from mint server
    let errorMsg = e.data || e.message;
    let errorCode = e.code || e.status;

    // If error data is a JSON string, try to parse it
    if (typeof errorMsg === 'string') {
      try {
        const parsed = JSON.parse(errorMsg);
        if (parsed.detail) {
          errorMsg = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
        } else if (parsed.message) {
          errorMsg = parsed.message;
        } else if (parsed.error) {
          errorMsg = parsed.error;
        }
        if (parsed.code) errorCode = parsed.code;
      } catch {
        // If parsing fails, use the original string
      }
    }

    // Check if error message is meaningless (hex string, very short, etc.)
    const isMeaningless = typeof errorMsg === 'string' && (
      /^[0-9a-f]{8,}$/i.test(errorMsg.trim()) || // Hex string
      errorMsg.trim().length < 3 || // Too short
      /^[0-9]+$/.test(errorMsg.trim()) // Just numbers
    );

    // Use a default message if the error is meaningless
    if (isMeaningless) {
      errorMsg = '송금 실패';
    }

    const response = { error: errorMsg };
    if (errorCode) response.code = errorCode;

    console.error('Melt error:', { originalError: e.data || e.message, code: errorCode, sentToClient: errorMsg });
    res.status(e.status || 500).json(response);
  }
});

// Check proof states (spent/unspent)
app.post('/api/cashu/check', async (req, res) => {
  try {
    const { proofs, mintUrl } = req.body || {};
    if (!proofs || !Array.isArray(proofs) || proofs.length === 0) {
      return res.status(400).json({ error: 'proofs 배열 필요' });
    }
    const result = await cashu.checkProofsState({ proofs, mintUrl });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.data || e.message });
  }
});

// Swap proofs for fresh ones
app.post('/api/cashu/swap', async (req, res) => {
  try {
    const { inputs, outputs, mintUrl, requestId } = req.body || {};
    console.log('[Swap] Received swap request');
    console.log('[Swap] - requestId:', requestId);
    console.log('[Swap] - inputs count:', inputs?.length);
    console.log('[Swap] - outputs count:', outputs?.length);
    console.log('[Swap] - mintUrl:', mintUrl);

    if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
      return res.status(400).json({ error: 'inputs 배열 필요' });
    }
    if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
      return res.status(400).json({ error: 'outputs 배열 필요' });
    }
    const result = await cashu.swap({ inputs, outputs, mintUrl });
    console.log('[Swap] Swap result:', {
      hasSignatures: !!result?.signatures,
      signaturesIsArray: Array.isArray(result?.signatures),
      signaturesCount: result?.signatures?.length,
      resultKeys: Object.keys(result || {})
    });

    // If this swap is for an eCash request, store the signatures for the receiver to poll
    if (requestId && result?.signatures && Array.isArray(result.signatures)) {
      const totalAmount = result.signatures.reduce((sum, sig) => {
        return sum + (parseInt(sig?.amount, 10) || 0);
      }, 0);

      ecashRequestSignatures.set(requestId, {
        signatures: result.signatures,
        amount: totalAmount,
        timestamp: new Date().toISOString()
      });

      // Clean up after 10 minutes
      setTimeout(() => {
        ecashRequestSignatures.delete(requestId);
      }, 10 * 60 * 1000);

      console.log(`[Swap] Stored signatures for eCash request ${requestId}: ${totalAmount} sats, total stored: ${ecashRequestSignatures.size}`);
    } else {
      console.log('[Swap] NOT storing signatures - requestId:', requestId, 'signatures:', result?.signatures?.length);
    }

    res.json(result);
  } catch (e) {
    console.error('[Swap] Swap error:', e);
    res.status(e.status || 500).json({ error: e.data || e.message });
  }
});

// Check if eCash request has been fulfilled (for receiver polling)
app.get('/api/cashu/ecash-request/check', (req, res) => {
  try {
    const { requestId, consume } = req.query;
    if (!requestId) {
      return res.status(400).json({ error: 'requestId 필요' });
    }

    console.log(`[Check] Checking requestId: ${requestId}, consume: ${consume}, total stored: ${ecashRequestSignatures.size}`);
    const data = ecashRequestSignatures.get(requestId);

    if (data) {
      // Only delete if consume=true is explicitly set (after successful processing)
      if (consume === 'true') {
        ecashRequestSignatures.delete(requestId);
        console.log(`[Check] eCash request ${requestId} consumed and removed by receiver`);
      } else {
        console.log(`[Check] eCash request ${requestId} checked by receiver (not consumed) - ${data.amount} sats`);
      }

      res.json({
        paid: true,
        signatures: data.signatures,
        amount: data.amount,
        timestamp: data.timestamp
      });
    } else {
      console.log(`[Check] eCash request ${requestId} NOT FOUND in storage`);
      res.json({ paid: false });
    }
  } catch (e) {
    console.error('[Check] eCash request check error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Resolve Lightning address (LNURL-Pay) to bolt11 for a given amount (sats)
app.post('/api/lightningaddr/quote', async (req, res) => {
  try {
    const { address, amount } = req.body || {};
    if (!address || !amount) return res.status(400).json({ error: 'address 및 amount 필요' });
    const out = await lnaddr.requestInvoice(address, parseInt(amount, 10));
    res.json(out);
  } catch (e) {
    const status = e.status || 500;
    const errorMessage = e.message || '라이트닝 주소 인보이스 발급 실패';
    const payload = { error: errorMessage };

    // Surface raw provider reason when available for debugging in client logs
    const providerReason = e.reason || e.data;
    if (providerReason && typeof providerReason === 'string' && providerReason.trim()) {
      payload.reason = providerReason.trim();
    }

    console.error('Lightning address invoice error:', {
      status,
      message: errorMessage,
      reason: e.reason || e.data,
      stack: e.stack,
    });

    res.status(status).json(payload);
  }
});

// Lightning invoice and payment routes removed - using Cashu only

app.use((req, res) => {
  res.status(404).json({ error: '요청한 엔드포인트를 찾을 수 없습니다' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '서버 내부 오류' });
});

server.listen(PORT, () => {
  console.log(`비트코인 매장 API 서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`WebSocket 서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`사용 가능한 엔드포인트:`);
  console.log(`   GET /api/stores - 모든 매장 조회`);
  console.log(`   GET /api/stores/random - 랜덤 매장 조회`);
  console.log(`   GET /api/stores/search?q=검색어 - 매장 검색`);
  console.log(`   GET /api/stores/:id - 특정 매장 조회`);
  console.log(`   POST /api/stores - 매장 추가`);
  console.log(`   GET /health - 서버 상태 확인`);
  console.log(`   WS  ws://localhost:${PORT} - WebSocket 연결`);
  console.log(`   DB 모드: ${db.mode}`);
});
