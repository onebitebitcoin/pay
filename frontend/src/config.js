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

const RAW_API_BASE = process.env.REACT_APP_API_BASE_URL || '';
export const API_BASE_URL = RAW_API_BASE.endsWith('/') ? RAW_API_BASE.slice(0, -1) : RAW_API_BASE;

export const apiUrl = (path = '/') => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};
