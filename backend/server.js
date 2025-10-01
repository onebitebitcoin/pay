const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const db = require('./db');
const { makeLightningProvider } = require('./lightning');
const cashu = require('./cashu');
const lnaddr = require('./lightningaddr');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
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

// Add a new store
app.post('/api/stores', (req, res) => {
  try {
    const {
      name,
      category,
      address,
      lat,
      lng,
      phone = null,
      hours = null,
      description = null,
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
      lat: parsedLat,
      lng: parsedLng,
      phone: phone ? String(phone).trim() : null,
      hours: hours ? String(hours).trim() : null,
      description: description ? String(description).trim() : null,
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('매장 추가 오류:', error);
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

// Lightning routes (proxied via server to keep secrets safe)
let lnProvider = null;
try {
  lnProvider = makeLightningProvider();
  console.log('Lightning provider initialized');
} catch (e) {
  console.warn('Lightning provider not configured:', e.message);
}

app.get('/api/lightning/balance', async (req, res) => {
  try {
    if (!lnProvider) return res.status(503).json({ error: 'Lightning 미구성' });
    const sats = await lnProvider.getBalance();
    res.json({ balance: sats });
  } catch (e) {
    res.status(500).json({ error: e.message || '잔액 조회 실패' });
  }
});


// Cashu Mint proxy (uses CASHU_MINT_URL). Minimal subset for LN mint/melt.
app.get('/api/cashu/info', async (req, res) => {
  try { res.json(await cashu.getInfo()); } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.get('/api/cashu/keys', async (req, res) => {
  try { res.json(await cashu.getKeys()); } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.post('/api/cashu/mint/quote', async (req, res) => {
  try {
    const { amount } = req.body || {};
    if (!amount || amount <= 0) return res.status(400).json({ error: 'amount 필요' });
    const out = await cashu.mintQuoteBolt11({ amount: parseInt(amount, 10) });
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.get('/api/cashu/mint/quote/check', async (req, res) => {
  try {
    const quote = req.query.quote;
    if (!quote) return res.status(400).json({ error: 'quote 필요' });
    const out = await cashu.checkMintQuote({ quote });
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.post('/api/cashu/mint/redeem', async (req, res) => {
  try {
    const { quote, outputs } = req.body || {};
    if (!quote) return res.status(400).json({ error: 'quote 필요' });
    if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
      return res.status(400).json({ error: 'outputs 배열 필요 (블라인드 출력)' });
    }
    // Forward full payload to support mints that require additional fields
    const out = await cashu.mintBolt11(req.body);
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.post('/api/cashu/melt/quote', async (req, res) => {
  try {
    const { invoice, request } = req.body || {};
    let bolt11 = (request || invoice || '').toString().trim();
    if (bolt11.toLowerCase().startsWith('lightning:')) {
      bolt11 = bolt11.slice('lightning:'.length);
    }
    if (!bolt11) return res.status(400).json({ error: 'request 필요' });
    const out = await cashu.meltQuoteBolt11({ request: bolt11 });
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

app.post('/api/cashu/melt', async (req, res) => {
  try {
    const { quote, inputs, proofs } = req.body || {};
    if (!quote) return res.status(400).json({ error: 'quote 필요' });
    if ((!inputs || !Array.isArray(inputs)) && (!proofs || !Array.isArray(proofs))) {
      return res.status(400).json({ error: 'inputs 또는 proofs 배열 필요' });
    }
    const out = await cashu.meltBolt11(req.body);
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.data || e.message }); }
});

// Resolve Lightning address (LNURL-Pay) to bolt11 for a given amount (sats)
app.post('/api/lightningaddr/quote', async (req, res) => {
  try {
    const { address, amount } = req.body || {};
    if (!address || !amount) return res.status(400).json({ error: 'address 및 amount 필요' });
    const out = await lnaddr.requestInvoice(address, parseInt(amount, 10));
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || '라이트닝 주소 인보이스 발급 실패' });
  }
});

app.post('/api/lightning/invoice', async (req, res) => {
  try {
    if (!lnProvider) return res.status(503).json({ error: 'Lightning 미구성' });
    const { amount, memo } = req.body || {};
    if (!amount || amount <= 0) return res.status(400).json({ error: 'amount 필요' });
    const result = await lnProvider.createInvoice({ amount: parseInt(amount, 10), memo });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || '인보이스 생성 실패' });
  }
});

app.post('/api/lightning/pay', async (req, res) => {
  try {
    if (!lnProvider) return res.status(503).json({ error: 'Lightning 미구성' });
    const { invoice } = req.body || {};
    if (!invoice || typeof invoice !== 'string') return res.status(400).json({ error: 'invoice 필요' });
    const result = await lnProvider.payInvoice({ invoice });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || '결제 실패' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: '요청한 엔드포인트를 찾을 수 없습니다' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '서버 내부 오류' });
});

app.listen(PORT, () => {
  console.log(`비트코인 매장 API 서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`사용 가능한 엔드포인트:`);
  console.log(`   GET /api/stores - 모든 매장 조회`);
  console.log(`   GET /api/stores/random - 랜덤 매장 조회`);
  console.log(`   GET /api/stores/search?q=검색어 - 매장 검색`);
  console.log(`   GET /api/stores/:id - 특정 매장 조회`);
  console.log(`   POST /api/stores - 매장 추가`);
  console.log(`   GET /health - 서버 상태 확인`);
  console.log(`   DB 모드: ${db.mode}`);
});
