// Centralized app configuration and safe defaults

export const DEFAULT_MINT_URL =
  process.env.REACT_APP_MINT_URL ||
  // Cashu Mint URL
  'https://mint.minibits.cash/Bitcoin';

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

  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:5001';
  }

  return 'https://pay.onebitebitcoin.com';
};

const RAW_API_BASE = resolveDefaultApiBase();
export const API_BASE_URL = RAW_API_BASE.endsWith('/') ? RAW_API_BASE.slice(0, -1) : RAW_API_BASE;

export const apiUrl = (path = '/') => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

export const KAKAO_APP_KEY = process.env.REACT_APP_KAKAO_APP_KEY || 'b6df438d2c946f441b6ff06cd87868ba';
export const KAKAO_SDK_URL = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false&libraries=services`;

let kakaoLoaderPromise = null;

export const loadKakaoSdk = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('브라우저 환경이 아닙니다'));
  }

  if (window.kakao && window.kakao.maps) {
    return Promise.resolve(window.kakao);
  }

  if (!KAKAO_APP_KEY) {
    return Promise.reject(new Error('카카오 앱 키가 설정되지 않았습니다'));
  }

  if (!kakaoLoaderPromise) {
    kakaoLoaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-kakao-sdk="true"]') ||
        document.querySelector('script[src*="dapi.kakao.com/v2/maps/sdk.js"]');

      const handleLoad = () => {
        if (window.kakao && window.kakao.maps) {
          resolve(window.kakao);
        } else {
          reject(new Error('카카오 SDK 로드 후 window.kakao가 없습니다'));
        }
      };

      const handleError = () => {
        reject(new Error('카카오 SDK 스크립트를 불러오지 못했습니다'));
      };

      if (existing) {
        existing.addEventListener('load', handleLoad, { once: true });
        existing.addEventListener('error', handleError, { once: true });
        if (existing.readyState === 'complete' || existing.readyState === 'loaded') {
          handleLoad();
        }
        return;
      }

      const script = document.createElement('script');
      script.src = KAKAO_SDK_URL;
      script.async = true;
      script.defer = true;
      script.dataset.kakaoSdk = 'true';
      script.onload = handleLoad;
      script.onerror = handleError;
      document.head.appendChild(script);
    });
  }

  return kakaoLoaderPromise;
};
