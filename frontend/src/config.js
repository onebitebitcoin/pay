// Centralized app configuration and safe defaults

export const DEFAULT_MINT_URL =
  process.env.REACT_APP_MINT_URL ||
  // Cashu Mint URL
  'https://mint.coinos.io';

// Lightning Network configuration
export const LIGHTNING_CONFIG = {
  network: 'mainnet',
  lnUrlPay: true,
  lnUrlWithdraw: true,
  defaultInvoiceExpiry: 3600, // 1 hour
};

// eCash configuration
export const ECASH_CONFIG = {
  defaultDenominations: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000],
  maxAmount: 100000, // 100k sats max per transaction
  feeRate: 0.001, // 0.1% fee
};

const resolveDefaultApiBase = () => {
  if (process.env.REACT_APP_API_BASE_URL) {
    return process.env.REACT_APP_API_BASE_URL;
  }

  // Always talk to the production API when the app itself is built for production.
  if (process.env.NODE_ENV === 'production') {
    return 'https://pay.onebitebitcoin.com';
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:5001';
    }
    if (host.endsWith('onebitebitcoin.com')) {
      return 'https://pay.onebitebitcoin.com';
    }
    return `${window.location.protocol}//${window.location.host}`;
  }

  return 'http://localhost:5001';
};

const RAW_API_BASE = resolveDefaultApiBase();
export const API_BASE_URL = RAW_API_BASE.endsWith('/') ? RAW_API_BASE.slice(0, -1) : RAW_API_BASE;

export const apiUrl = (path = '/') => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

export const KAKAO_APP_KEY = process.env.REACT_APP_KAKAO_APP_KEY || 'b6df438d2c946f441b6ff06cd87868ba';
export const KAKAO_SDK_URL = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&libraries=services&autoload=false`;

let kakaoLoaderPromise = null;

const waitForKakaoLoadFunction = (maxRetries = 30, delay = 100) =>
  new Promise((resolve, reject) => {
    let attempt = 0;

    const verify = () => {
      attempt += 1;
      const hasLoadFn = Boolean(window.kakao && window.kakao.maps && typeof window.kakao.maps.load === 'function');
      console.log(`[loadKakaoSdk] Waiting for kakao.maps.load (attempt ${attempt}/${maxRetries})...`, 'hasLoadFn:', hasLoadFn);

      if (hasLoadFn) {
        resolve();
        return;
      }

      if (attempt >= maxRetries) {
        reject(new Error('kakao.maps.load not available'));
        return;
      }

      setTimeout(verify, delay);
    };

    verify();
  });

export const loadKakaoSdk = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Not in browser environment'));
  }

  // Check if already loaded with services
  if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
    console.log('[loadKakaoSdk] ✅ Already loaded with services');
    return Promise.resolve(window.kakao);
  }

  if (!KAKAO_APP_KEY) {
    return Promise.reject(new Error('Kakao app key is not configured'));
  }

  if (!kakaoLoaderPromise) {
    kakaoLoaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-kakao-sdk="true"]') ||
        document.querySelector('script[src*="dapi.kakao.com/v2/maps/sdk.js"]');

      const handleLoad = () => {
        console.log('[loadKakaoSdk] Script loaded, waiting for kakao.maps.load...');

        waitForKakaoLoadFunction()
          .then(() => {
            console.log('[loadKakaoSdk] Calling kakao.maps.load to finalize services');
            window.kakao.maps.load(() => {
              const servicesReady = Boolean(window.kakao && window.kakao.maps && window.kakao.maps.services);
              console.log('[loadKakaoSdk] Services ready after load:', servicesReady);

              if (servicesReady) {
                console.log('[loadKakaoSdk] ✅ All services loaded via kakao.maps.load');
                resolve(window.kakao);
              } else {
                console.error('[loadKakaoSdk] ❌ Kakao services missing even after load');
                kakaoLoaderPromise = null;
                reject(new Error('Kakao services not available after kakao.maps.load'));
              }
            });
          })
          .catch((err) => {
            console.error('[loadKakaoSdk] ❌ Failed while waiting for kakao.maps.load:', err);
            kakaoLoaderPromise = null;
            reject(err);
          });
      };

      const handleError = () => {
        console.error('[loadKakaoSdk] ❌ Failed to load script');
        kakaoLoaderPromise = null;
        reject(new Error('Failed to load Kakao SDK script'));
      };

      if (existing) {
        console.log('[loadKakaoSdk] Found existing script');
        existing.addEventListener('load', handleLoad, { once: true });
        existing.addEventListener('error', handleError, { once: true });
        if (existing.readyState === 'complete' || existing.readyState === 'loaded') {
          console.log('[loadKakaoSdk] Script already complete');
          handleLoad();
        }
        return;
      }

      console.log('[loadKakaoSdk] Creating new script');
      console.log('[loadKakaoSdk] URL:', KAKAO_SDK_URL);
      const script = document.createElement('script');
      script.src = KAKAO_SDK_URL;
      script.dataset.kakaoSdk = 'true';
      script.onload = handleLoad;
      script.onerror = handleError;
      document.head.appendChild(script);
    });
  }

  return kakaoLoaderPromise;
};
