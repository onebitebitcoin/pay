import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DEFAULT_MINT_URL, ECASH_CONFIG, apiUrl, API_BASE_URL } from '../config';
// Cashu mode: no join/federation or gateway UI
import { getBalanceSats, selectProofsForAmount, addProofs, removeProofs, loadProofs, exportProofsJson, importProofsFrom, syncProofsWithMint, toggleProofDisabled, calculateBalanceFromProofs } from '../services/cashu';
import { createBlindedOutputs, signaturesToProofs, serializeOutputDatas, deserializeOutputDatas } from '../services/cashuProtocol';
import { createPaymentRequest, parsePaymentRequest, createPaymentPayload, sendPaymentViaPost, createHttpPostTransport, isCashuToken, parseCashuToken, extractProofsFromToken, createCashuToken } from '../services/nut18';
import { sendPaymentViaNostr, ensureNostrIdentity, subscribeToNostrDms } from '../services/nostrTransport';
import './Wallet.css';
import Icon from '../components/Icon';
import QrScanner from '../components/QrScanner';
const SATS_PER_BTC = 100000000;
const MAX_CONVERSION_AMOUNT = ECASH_CONFIG.maxAmount;
const CONVERSION_FEE_RATE = ECASH_CONFIG.feeRate;
const ECASH_SEND_MAX_DIGITS = 10;

const normalizeQrValue = (rawValue = '') => {
  if (!rawValue) return '';
  let cleaned = String(rawValue).trim();
  cleaned = cleaned.replace(/^payment:(\/\/)?/i, '');
  cleaned = cleaned.replace(/^lightning:(\/\/)?/i, '');
  if (/^bitcoin:(\/\/)?/i.test(cleaned)) {
    cleaned = cleaned.replace(/^bitcoin:(\/\/)?/i, '');
    const queryIndex = cleaned.indexOf('?');
    cleaned = queryIndex >= 0 ? cleaned.slice(0, queryIndex) : cleaned;
  }
  const compact = cleaned.replace(/\s+/g, '');
  if (/^ln(bc|tb|o)/i.test(compact)) {
    return compact.toLowerCase();
  }
  return compact;
};

// Normalize proofs for API calls - ensure witness/dleq is a JSON string
const normalizeProofsForApi = (proofs) => {
  if (!Array.isArray(proofs)) return proofs;
  return proofs.map(proof => {
    if (!proof) return proof;

    const normalized = {
      amount: proof.amount,
      secret: proof.secret,
      C: proof.C
    };

    // Add id if present
    if (proof.id) {
      normalized.id = proof.id;
    }

    // Handle witness field (convert object to JSON string)
    if (proof.witness) {
      normalized.witness = typeof proof.witness === 'object'
        ? JSON.stringify(proof.witness)
        : proof.witness;
    }
    // Handle legacy dleq field (rename to witness and convert to JSON string)
    else if (proof.dleq) {
      normalized.witness = typeof proof.dleq === 'object'
        ? JSON.stringify(proof.dleq)
        : proof.dleq;
    }

    return normalized;
  });
};

const RECEIVE_MIN_AMOUNT = 1;
const RECEIVE_MAX_AMOUNT = ECASH_CONFIG.maxAmount;

const createInitialFiatState = (language = 'en') => {
  switch (language) {
    case 'ko':
      return {
        currency: 'KRW',
        symbol: '₩',
        rate: null,
        sourceKey: 'upbit',
        loading: false,
        error: '',
        lastUpdated: null,
      };
    case 'ja':
      return {
        currency: 'JPY',
        symbol: '¥',
        rate: null,
        sourceKey: 'coingecko',
        loading: false,
        error: '',
        lastUpdated: null,
      };
    default:
      return {
        currency: 'USD',
        symbol: '$',
        rate: null,
        sourceKey: 'coingecko',
        loading: false,
        error: '',
        lastUpdated: null,
      };
  }
};

function Wallet() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.title = t('pageTitle.wallet');
  }, [t, i18n.language]);

  // Load wallet name from settings
  useEffect(() => {
    try {
      const settings = JSON.parse(localStorage.getItem('app_settings') || '{}');
      setWalletName(settings.walletName || '');
    } catch (e) {
      console.error('Failed to load wallet name:', e);
    }
  }, []);

  // Initialize balance from localStorage immediately
  const [ecashBalance, setEcashBalance] = useState(() => {
    try {
      return getBalanceSats();
    } catch {
      return 0;
    }
  });
  // Initialize transactions from localStorage immediately
  const [transactions, setTransactions] = useState(() => {
    try {
      const raw = localStorage.getItem('cashu_tx_v1');
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.map((tx) => ({
        ...tx,
        mintUrl: typeof tx?.mintUrl === 'string' ? tx.mintUrl.trim() : '',
      }));
    } catch {
      return [];
    }
  });
  const TX_STORAGE_KEY = 'cashu_tx_v1';
  const [displayedTxCount, setDisplayedTxCount] = useState(10);
  const [walletName, setWalletName] = useState('');
  const [showSend, setShowSend] = useState(false);
  const [txUpdateCounter, setTxUpdateCounter] = useState(0);
  const [showConvert, setShowConvert] = useState(false);

  // Debug transactions state changes
  useEffect(() => {
    console.log('[Transactions State] Updated:', transactions.length, 'transactions');
    console.log('[Transactions State] Data:', transactions);
  }, [transactions]);
  // Cashu mode: no explicit join modal
  const [receiveAmount, setReceiveAmount] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [convertAmount, setConvertAmount] = useState('');
  const [convertDirection, setConvertDirection] = useState('ln_to_ecash'); // 'ln_to_ecash' or 'ecash_to_ln'
  const [sendAddress, setSendAddress] = useState('');
  const [enableSendScanner, setEnableSendScanner] = useState(false);
  const [invoiceQuote, setInvoiceQuote] = useState(null);
  const [invoiceError, setInvoiceError] = useState('');
  const [invoice, setInvoice] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingQuote, setFetchingQuote] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const fileInputRef = useRef(null);
  const wasReceiveViewRef = useRef(false);
  const [receiveCompleted, setReceiveCompleted] = useState(false);
  const [lastReceiveMode, setLastReceiveMode] = useState('lightning');
  const [receivedAmount, setReceivedAmount] = useState(0);
  const [showPassphraseModal, setShowPassphraseModal] = useState(false);
  const [passphraseAction, setPassphraseAction] = useState('backup'); // 'backup' or 'restore'
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [showTxDetail, setShowTxDetail] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);
  const [invoiceCopied, setInvoiceCopied] = useState(false);
  const [qrLoaded, setQrLoaded] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrModalPayload, setQrModalPayload] = useState(null);
  const [infoMessage, setInfoMessage] = useState('');
  const [infoMessageType, setInfoMessageType] = useState('info'); // 'info', 'success', 'error'
  const [showProofs, setShowProofs] = useState(false);
  const [proofs, setProofs] = useState(() => loadProofs());
  useEffect(() => {
    setProofs(loadProofs());
  }, [ecashBalance, txUpdateCounter]);
  const pendingEcashTransactions = useMemo(
    () => transactions.filter((tx) => tx?.type === 'receive' && tx?.status === 'pending'),
    [transactions]
  );
  const totalEcashItems = proofs.length + pendingEcashTransactions.length;
  const [receiveAmountTooLow, setReceiveAmountTooLow] = useState(false);
  const [receiveAmountTooHigh, setReceiveAmountTooHigh] = useState(false);
  const [fiatRate, setFiatRate] = useState(() => createInitialFiatState(i18n.language));
  const [receiveTab, setReceiveTab] = useState('lightning');
  const [sendTab, setSendTab] = useState('lightning');
  const [ecashSendAmountInput, setEcashSendAmountInput] = useState('');
  const [ecashSendToken, setEcashSendToken] = useState('');
  const [ecashSendTokenAmount, setEcashSendTokenAmount] = useState(0);
  const [ecashSendTokenMint, setEcashSendTokenMint] = useState('');
  const [ecashSendError, setEcashSendError] = useState('');
  const [ecashTokenCopied, setEcashTokenCopied] = useState(false);
  // Removed eCash receive tab - Lightning only for privacy
  const [ecashRequest, setEcashRequest] = useState(''); // eCash request string
  const [ecashRequestId, setEcashRequestId] = useState(null); // Request ID for polling
  const [showRequestDetails, setShowRequestDetails] = useState(false); // Toggle for eCash request details
  const [ecashTokenInput, setEcashTokenInput] = useState(''); // eCash token input (cashuA...)
  const [enableTokenScanner, setEnableTokenScanner] = useState(false); // QR scanner for token

  const nostrSubscriptionRef = useRef(null);
  const nostrHandledEventsRef = useRef(new Set());
  const [nostrIdentity, setNostrIdentity] = useState(null);
  const [nostrError, setNostrError] = useState('');

  const PENDING_MINT_STORAGE_KEY = 'cashu_pending_mint_v1';
  const pendingMintRef = useRef(null);
  const ecashPollingRef = useRef(null);
  const swapFeeHintsRef = useRef({});

  const navigate = useNavigate();
  const location = useLocation();
  const receiveOriginRef = useRef('/wallet');
  const sendOriginRef = useRef('/wallet');
  const isReceiveView = location.pathname === '/wallet/receive';
  const isSendView = location.pathname === '/wallet/send';

  const networkDisconnectedMessage = t('wallet.networkDisconnected');
  const locale = i18n.language === 'ko' ? 'ko-KR' : i18n.language === 'ja' ? 'ja-JP' : 'en-US';

  useEffect(() => {
    let active = true;
    const defaults = createInitialFiatState(i18n.language);
    setFiatRate(() => ({
      ...defaults,
      rate: null,
      lastUpdated: null,
    }));

    const fetchFiatRate = async () => {
      try {
        if (!active) {
          return;
        }
        setFiatRate((prev) => ({ ...prev, loading: true, error: '' }));

        let rate = null;
        let sourceKey = defaults.sourceKey;

        if (i18n.language === 'ko') {
          try {
            const response = await fetch(apiUrl('/api/rates/krw-btc'));
            if (!response.ok) {
              throw new Error(`Upbit proxy responded with ${response.status}`);
            }
            const data = await response.json();
            const tradePrice = Number(data?.rate ?? data?.[0]?.trade_price);
            if (!Number.isFinite(tradePrice)) {
              throw new Error('Upbit trade price missing');
            }
            rate = tradePrice;
            sourceKey = data?.source || 'upbit';
          } catch (error) {
            console.warn('Failed to fetch Upbit rate via backend, falling back to CoinGecko:', error);
          }
        }

        if (rate === null) {
          const vsCurrency = i18n.language === 'ja' ? 'jpy' : i18n.language === 'ko' ? 'krw' : 'usd';
          const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${vsCurrency}`);
          if (!response.ok) {
            throw new Error(`CoinGecko responded with ${response.status}`);
          }
          const data = await response.json();
          const price = Number(data?.bitcoin?.[vsCurrency]);
          if (!Number.isFinite(price)) {
            throw new Error('CoinGecko price missing');
          }
          rate = price;
          sourceKey = i18n.language === 'ko' && sourceKey === 'upbit' ? 'upbit' : 'coingecko';
        }

        if (!active) {
          return;
        }

        setFiatRate({
          currency: defaults.currency,
          symbol: defaults.symbol,
          rate,
          sourceKey,
          loading: false,
          error: '',
          lastUpdated: Date.now(),
        });
      } catch (error) {
        if (!active) {
          return;
        }
        console.error('Failed to load fiat rate:', error);
        setFiatRate((prev) => ({
          ...prev,
          rate: null,
          loading: false,
          error: error?.message || 'Rate fetch failed',
        }));
      }
    };

    fetchFiatRate();
    const interval = setInterval(fetchFiatRate, 60 * 1000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [i18n.language]);

  const fiatFormatter = useMemo(() => {
    const fractionDigits = fiatRate.currency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: fiatRate.currency,
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits === 0 ? 0 : 2,
    });
  }, [fiatRate.currency, locale]);

  const formatFiatAmount = useCallback((sats) => {
    if (!fiatRate.rate) {
      return null;
    }
    const numeric = Number(sats);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    const fiatValue = (numeric / SATS_PER_BTC) * fiatRate.rate;
    if (!Number.isFinite(fiatValue)) {
      return null;
    }
    try {
      return fiatFormatter.format(fiatValue);
    } catch (error) {
      console.warn('Failed to format fiat amount', { fiatValue, error });
      return null;
    }
  }, [fiatRate.rate, fiatFormatter]);

  // Parse eCash payment request (must be defined before pendingPaymentRequest useMemo)
  const parseEcashRequest = useCallback((val) => {
    try {
      if (!val || typeof val !== 'string') return null;
      const trimmed = val.trim();
      if (/^creqA/.test(trimmed)) {
        return parsePaymentRequest(trimmed);
      }
      return null;
    } catch (error) {
      console.error('Failed to parse eCash request:', error);
      return null;
    }
  }, []);

  // Translate common error messages (must be defined early for use in handlers)
  const translateErrorMessage = useCallback((errorMsg) => {
    if (!errorMsg || typeof errorMsg !== 'string') return errorMsg;

    const msg = errorMsg.toLowerCase();

    // Already paid errors
    if (msg.includes('already paid') || msg.includes('alreday paid')) {
      return t('messages.alreadyPaidInvoice');
    }

    // Invoice expired
    if (msg.includes('expired') || msg.includes('expire')) {
      return t('messages.expiredInvoice');
    }

    // Invalid invoice
    if (msg.includes('invalid invoice') || msg.includes('invalid bolt11')) {
      return t('messages.invalidInvoice');
    }

    // Insufficient balance
    if (msg.includes('insufficient') || msg.includes('not enough')) {
      return t('messages.insufficientBalanceSimple');
    }

    // Payment failed
    if (msg.includes('payment failed') || msg.includes('failed to pay')) {
      return t('messages.paymentFailed');
    }

    // Route not found
    if (msg.includes('no route') || msg.includes('route not found')) {
      return t('messages.noRouteFound');
    }

    // Timeout
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return t('messages.requestTimeout');
    }

    // Connection error
    if (msg.includes('connection') || msg.includes('network')) {
      return t('messages.networkError');
    }

    if (msg.includes('keyset') || msg.includes('wrong mint') || msg.includes('other mint') || msg.includes('different mint') || msg.includes('unknown mint') || msg.includes('not from this mint')) {
      return t('messages.mintMismatchSendShort');
    }

    // Return original message if no match
    return errorMsg;
  }, [t]);

  const rateSourceLabel = fiatRate.sourceKey ? t(`wallet.rateSource.${fiatRate.sourceKey}`) : '';
  const balanceFiatDisplay = formatFiatAmount(ecashBalance);
  const ecashSendAmountValue = Number(ecashSendAmountInput || 0);
  const receiveFiatDisplay = formatFiatAmount(receiveAmount);
  const receivedFiatDisplay = formatFiatAmount(receivedAmount);
  const sendFiatDisplay = formatFiatAmount(sendAmount);
  const ecashSendFiatDisplay = formatFiatAmount(ecashSendAmountValue);
  const ecashTokenFiatDisplay = formatFiatAmount(ecashSendTokenAmount || 0);
  const pendingPaymentRequest = useMemo(() => {
    if (!ecashRequest) return null;
    try {
      return parseEcashRequest(ecashRequest);
    } catch (error) {
      console.error('Failed to parse pending payment request:', error);
      return null;
    }
  }, [ecashRequest, parseEcashRequest]);
  const formatTransportLabels = useCallback((transports = []) => {
    if (!Array.isArray(transports) || transports.length === 0) {
      return '';
    }
    return transports.map((transport) => {
      const type = (transport?.t || transport?.type || '').toString().toLowerCase();
      if (type === 'nostr') return t('wallet.nostrTransport');
      if (type === 'post' || type === 'http' || type === 'https') return t('wallet.httpTransport');
      return type ? type.toUpperCase() : t('wallet.unknownTransport');
    }).join(', ');
  }, [t]);
  const pendingRequestAmount = pendingPaymentRequest?.amount || Number(receiveAmount) || 0;
  const paymentRequestFiatDisplay = formatFiatAmount(pendingRequestAmount);
  const activeTransportSummary = useMemo(() => {
    if (!pendingPaymentRequest || !Array.isArray(pendingPaymentRequest.transports)) {
      return '';
    }
    return formatTransportLabels(pendingPaymentRequest.transports);
  }, [pendingPaymentRequest, formatTransportLabels]);

  const clearPendingMint = useCallback(() => {
    pendingMintRef.current = null;
    try {
      localStorage.removeItem(PENDING_MINT_STORAGE_KEY);
    } catch (err) {
      console.warn('Failed to delete pending mint:', err);
    }
  }, [PENDING_MINT_STORAGE_KEY]);

  const savePendingMint = useCallback((quote, outputDatas, amount = 0) => {
    if (!quote || !Array.isArray(outputDatas) || outputDatas.length === 0) return;
    const record = {
      quote,
      outputDatas,
      amount: amount || 0,
      createdAt: Date.now(),
    };
    pendingMintRef.current = record;
    try {
      const serialized = serializeOutputDatas(outputDatas);
      localStorage.setItem(
        PENDING_MINT_STORAGE_KEY,
        JSON.stringify({
          quote,
          amount: record.amount,
          createdAt: record.createdAt,
          outputDatas: serialized,
        })
      );
    } catch (err) {
      console.error('Failed to save pending mint:', err);
    }
  }, [PENDING_MINT_STORAGE_KEY]);

  const ensurePendingMint = useCallback(async (quote) => {
    if (!quote) return null;
    const current = pendingMintRef.current;
    if (current && current.quote === quote && Array.isArray(current.outputDatas) && current.outputDatas.length) {
      return current;
    }
    try {
      const raw = localStorage.getItem(PENDING_MINT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.quote !== quote || !Array.isArray(parsed.outputDatas)) {
        return null;
      }
      const restored = await deserializeOutputDatas(parsed.outputDatas);
      if (!restored || restored.length === 0) return null;
      const record = {
        quote,
        outputDatas: restored,
        amount: parsed.amount || 0,
        createdAt: parsed.createdAt || Date.now(),
      };
      pendingMintRef.current = record;
      return record;
    } catch (err) {
      console.error('Failed to restore pending mint:', err);
      return null;
    }
  }, [PENDING_MINT_STORAGE_KEY]);

  // Storage warnings
  const [storageHealthy, setStorageHealthy] = useState(true);
  const [showBackupBanner, setShowBackupBanner] = useState(false);

  // Mint connection status
  const [isConnected, setIsConnected] = useState(false);
  const [mintUrl, setMintUrl] = useState(() => {
    try {
      const settings = JSON.parse(localStorage.getItem('app_settings') || '{}');
      return settings.mintUrl || DEFAULT_MINT_URL;
    } catch {
      return DEFAULT_MINT_URL;
    }
  });
  // Removed inline mint explainer (moved to About page)

  const closeQrModal = useCallback(() => {
    setShowQrModal(false);
    setQrModalPayload(null);
  }, []);

  const openQrModal = useCallback((type, amountOverride) => {
    let data = '';
    if (type === 'lightning') {
      data = invoice;
    } else if (type === 'ecash') {
      data = ecashRequest;
    }

    if (!data) {
      return;
    }

    const normalizedAmount = typeof amountOverride === 'number'
      ? amountOverride
      : pendingRequestAmount || Number(receiveAmount) || 0;

    setQrModalPayload({
      type,
      data,
      amount: normalizedAmount,
      mint: mintUrl
    });
    setShowQrModal(true);
  }, [ecashRequest, invoice, mintUrl, pendingRequestAmount, receiveAmount]);

  const qrModalAmountValue = qrModalPayload?.amount || pendingRequestAmount || Number(receiveAmount) || 0;
  const qrModalMintSource = qrModalPayload?.mint || mintUrl || '';
  const qrModalMintLabel = qrModalMintSource.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const qrModalDataValue = (() => {
    if (!qrModalPayload?.data) {
      return '';
    }
    if (qrModalPayload.type === 'lightning') {
      const invoiceValue = qrModalPayload.data || '';
      return invoiceValue.toLowerCase().startsWith('ln') ? `lightning:${invoiceValue}` : invoiceValue;
    }
    return qrModalPayload.data;
  })();
  const qrModalAltText = qrModalPayload?.type === 'ecash'
    ? 'NUT-18 Payment Request QR Code'
    : qrModalPayload?.type === 'token'
      ? 'Cashu Token QR Code'
      : 'Lightning Invoice QR Code';

  useEffect(() => {
    // Check storage health
    try {
      const k = 'cashu_storage_check_' + Math.random();
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      setStorageHealthy(true);
    } catch {
      setStorageHealthy(false);
    }
  }, []);

  useEffect(() => {
    if (isReceiveView) {
      const state = location.state;
      if (state && typeof state === 'object' && state.from) {
        receiveOriginRef.current = state.from;
      }
    }
    if (isSendView) {
      const state = location.state;
      if (state && typeof state === 'object' && state.from) {
        sendOriginRef.current = state.from;
      }
    }
  }, [isReceiveView, isSendView, location.state]);

  useEffect(() => {
    if (sendTab === 'ecash' && enableSendScanner) {
      setEnableSendScanner(false);
    }
  }, [sendTab, enableSendScanner]);

  useEffect(() => {
    // Show backup banner when there is balance and not dismissed
    try {
      const dismissed = localStorage.getItem('cashu_backup_dismissed') === '1';
      setShowBackupBanner(!dismissed && ecashBalance > 0);
    } catch {
      setShowBackupBanner(ecashBalance > 0);
    }
  }, [ecashBalance]);

  useEffect(() => {
    if (showSend || isSendView) {
      setEnableSendScanner(true);
    } else {
      setEnableSendScanner(false);
    }
  }, [showSend, isSendView]);

  // Warn on page unload if there is any eCash balance
  useEffect(() => {
    const needWarn = ecashBalance > 0;
    if (!needWarn) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [ecashBalance]);


  const addToast = useCallback((message, type = 'success', timeout = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    if (timeout) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, timeout);
    }
  }, []);

  const showInfoMessage = useCallback((message, type = 'info', timeout = 5000) => {
    setInfoMessage(message);
    setInfoMessageType(type);
    if (timeout) {
      setTimeout(() => {
        setInfoMessage('');
      }, timeout);
    }
  }, []);

  const formatAmount = useCallback((sats) => {
    const localeMap = {
      ko: 'ko-KR',
      en: 'en-US',
      ja: 'ja-JP'
    };
    const locale = localeMap[i18n.language] || 'en-US';
    return new Intl.NumberFormat(locale).format(sats);
  }, [i18n.language]);

  const formatDate = (timestamp) => {
    // Map i18n language to locale
    const localeMap = {
      ko: 'ko-KR',
      en: 'en-US',
      ja: 'ja-JP'
    };
    const locale = localeMap[i18n.language] || 'en-US';

    return new Date(timestamp).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const loadWalletData = useCallback(async (showLoading = false, syncWithMint = false) => {
    try {
      if (showLoading) setLoading(true);
      try { importProofsFrom(loadProofs()); } catch {}

      // Sync proofs with Mint server if requested
      if (syncWithMint) {
        try {
          const syncResult = await syncProofsWithMint(API_BASE_URL, mintUrl);
          if (syncResult.removed > 0) {
            showInfoMessage(t('messages.removedUsedTokens', { count: syncResult.removed }), 'info', 3000);
          }
        } catch (syncErr) {
          console.error('Proof sync failed:', syncErr);
        }
      }

      setEcashBalance(getBalanceSats());
    } catch (error) {
      console.error('Failed to load wallet data:', error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [showInfoMessage, mintUrl, t]);

  const handleToggleProof = useCallback((proof) => {
    if (!proof) return;
    const proofKey = proof?.secret || JSON.stringify(proof);
    const updatedProofs = toggleProofDisabled(proofKey);
    if (Array.isArray(updatedProofs)) {
      setProofs(updatedProofs);
      setEcashBalance(calculateBalanceFromProofs(updatedProofs));
    } else {
      // Fallback to ensure UI stays in sync if toggle failed
      setProofs(loadProofs());
      setEcashBalance(getBalanceSats());
    }
  }, []);

  const persistTransactions = useCallback((list) => {
    const sanitizedList = Array.isArray(list)
      ? list.map((tx) => ({
          ...tx,
          mintUrl: typeof tx?.mintUrl === 'string' ? tx.mintUrl.trim() : '',
        }))
      : [];
    console.log('[persistTransactions] Saving to localStorage:', sanitizedList.length, 'transactions');
    try {
      const data = JSON.stringify(sanitizedList);
      localStorage.setItem(TX_STORAGE_KEY, data);
      // Verify save
      const saved = localStorage.getItem(TX_STORAGE_KEY);
      if (saved === data) {
        console.log('[persistTransactions] Saved and verified successfully');
      } else {
        console.error('[persistTransactions] Save verification failed');
        // Try saving again if verification failed
        localStorage.setItem(TX_STORAGE_KEY, data);
      }
    } catch (err) {
      console.error('[persistTransactions] Failed to save:', err);
      // Fallback: try to save with smaller string if needed
      try {
        localStorage.setItem(TX_STORAGE_KEY, JSON.stringify([]));
      } catch (e) {
        console.error('[persistTransactions] LocalStorage completely unavailable:', e);
      }
    }
  }, [TX_STORAGE_KEY]);

  const addTransaction = useCallback((tx) => {
    const normalizedTx = {
      ...tx,
      mintUrl:
        typeof tx?.mintUrl === 'string' && tx.mintUrl.trim()
          ? tx.mintUrl.trim()
          : (typeof mintUrl === 'string' ? mintUrl.trim() : ''),
    };

    console.log('[addTransaction] Adding transaction:', normalizedTx);
    console.log('[addTransaction] setTransactions will be called');

    // Create a new transaction array immediately to ensure we have the latest data
    setTransactions(prev => {
      console.log('[addTransaction - INSIDE setTransactions] Callback executing');
      const prevArray = Array.isArray(prev) ? prev : [];
      console.log('[addTransaction - INSIDE setTransactions] Current transactions count:', prevArray.length);
      console.log('[addTransaction - INSIDE setTransactions] Current transactions:', prevArray);

      // Check for duplicate transactions (within 1 second, same type, amount, and description)
      const isDuplicate = prevArray.some(existing =>
        existing.type === normalizedTx.type &&
        existing.amount === normalizedTx.amount &&
        existing.description === normalizedTx.description &&
        Math.abs(new Date(existing.timestamp).getTime() - new Date(normalizedTx.timestamp).getTime()) < 1000
      );

      if (isDuplicate) {
        console.log('[addTransaction - INSIDE setTransactions] Duplicate transaction detected, skipping:', normalizedTx);
        return prev;
      }

      const next = [normalizedTx, ...prevArray];
      console.log('[addTransaction - INSIDE setTransactions] Will save:', next.length, 'transactions');
      persistTransactions(next);
      console.log('[addTransaction - INSIDE setTransactions] Transaction added successfully. New count:', next.length);
      return next;
    });

    // Increment counter to force UI update on transaction changes
    setTxUpdateCounter(prev => prev + 1);
  }, [persistTransactions, mintUrl]);

  const markQuoteRedeemed = useCallback((q) => {
    try {
      const raw = localStorage.getItem('cashu_redeemed_quotes') || '[]';
      const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
      if (!arr.includes(q)) arr.push(q);
      localStorage.setItem('cashu_redeemed_quotes', JSON.stringify(arr));
    } catch {}
  }, []);

  const stopAutoRedeem = useCallback(() => {
    // Stop polling if active
    if (pollingCancelRef.current) {
      console.log('[stopAutoRedeem] Cancelling active polling');
      pollingCancelRef.current();
      pollingCancelRef.current = null;
    }
    setCheckingPayment(false);
  }, []);

  const connectMint = useCallback(async () => {
    try {
      setLoading(true);

      // Try main URL first
      const settings = JSON.parse(localStorage.getItem('app_settings') || '{}');
      const backupUrl = settings.backupMintUrl;

      let resp = await fetch(apiUrl(`/api/cashu/info?mintUrl=${encodeURIComponent(mintUrl)}`));

      // If main URL fails and backup URL exists, try backup
      if (!resp.ok && backupUrl) {
        console.log('Main Mint URL failed, trying backup:', backupUrl);

        // Update config to use backup URL temporarily
        const originalMintUrl = mintUrl;
        setMintUrl(backupUrl);

        // Update settings to use backup URL
        const newSettings = {
          ...settings,
          mintUrl: backupUrl,
          backupMintUrl: originalMintUrl
        };
        localStorage.setItem('app_settings', JSON.stringify(newSettings));

        // Try backup URL
        resp = await fetch(apiUrl(`/api/cashu/info?mintUrl=${encodeURIComponent(backupUrl)}`));

        if (!resp.ok) {
          // Both failed, revert
          setMintUrl(originalMintUrl);
          localStorage.setItem('app_settings', JSON.stringify(settings));
          throw new Error(t('messages.mainBackupMintFailed'));
        }

        showInfoMessage(t('messages.connectedToBackupMint'), 'info');
      } else if (!resp.ok) {
        throw new Error(t('messages.mintInfoFailed'));
      }

      setIsConnected(true);
      await loadWalletData(false, true); // Sync with Mint on connect
    } catch (e) {
      console.error(e);
      showInfoMessage(e.message || t('messages.mintConnectionFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [loadWalletData, mintUrl, showInfoMessage, t]);

  const applyRedeemedSignatures = useCallback(async (quote, signatures, amountHint = 0) => {
    if (!quote || !Array.isArray(signatures) || signatures.length === 0) {
      return { ok: false, reason: 'missing_signatures' };
    }

    const pending = await ensurePendingMint(quote);
    if (!pending || !Array.isArray(pending.outputDatas) || pending.outputDatas.length === 0) {
      return { ok: false, reason: 'missing_output_datas' };
    }

    try {
      const keysResp = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl)}`));
      if (!keysResp.ok) {
        return { ok: false, reason: 'mint_keys_failed' };
      }
      const mintKeys = await keysResp.json();
      const proofs = await signaturesToProofs(signatures, mintKeys, pending.outputDatas);
      addProofs(proofs, mintUrl);
      const credited = proofs.reduce((sum, p) => sum + Number(p?.amount || 0), 0);
      setEcashBalance(getBalanceSats());
      clearPendingMint();
      return {
        ok: true,
        added: credited || amountHint || 0,
      };
    } catch (error) {
      console.error('Failed to apply redeemed signatures:', error);
      return { ok: false, reason: 'apply_failed', error };
    }
  }, [clearPendingMint, ensurePendingMint, mintUrl]);

  const processPaymentNotification = useCallback(async (detail) => {
    console.log('[processPaymentNotification] Called with detail:', detail);
    const quote = detail?.quote;
    const amount = parseInt(detail?.amount || 0, 10) || 0;
    const timestamp = detail?.timestamp || new Date().toISOString();
    const lastQuote = localStorage.getItem('cashu_last_quote');

    console.log('[processPaymentNotification] quote:', quote, 'amount:', amount, 'lastQuote:', lastQuote);

    if (quote === lastQuote) {
      try { stopAutoRedeem(); } catch {}
      setCheckingPayment(false);
      setReceiveCompleted(true);
      setLastReceiveMode('lightning');
      // Close QR modal if open
      closeQrModal();
    }

    let signatures = Array.isArray(detail?.signatures) ? detail.signatures : [];
    console.log('[processPaymentNotification] Initial signatures count:', signatures.length);

    if ((!signatures || signatures.length === 0) && quote) {
      try {
        console.log('[processPaymentNotification] Fetching signatures from API...');
        const resultResp = await fetch(apiUrl(`/api/cashu/mint/result?quote=${encodeURIComponent(quote)}`));
        if (resultResp.ok) {
          const resJson = await resultResp.json();
          if (Array.isArray(resJson?.signatures) && resJson.signatures.length) {
            signatures = resJson.signatures;
            console.log('[processPaymentNotification] Fetched signatures count:', signatures.length);
          }
        }
      } catch (err) {
        console.error('Failed to check payment result:', err);
      }
    }

    let creditedAmount = 0;
    if (quote && Array.isArray(signatures) && signatures.length) {
      console.log('[processPaymentNotification] Applying redeemed signatures...');
      const applyResult = await applyRedeemedSignatures(quote, signatures, amount);
      console.log('[processPaymentNotification] Apply result:', applyResult);
      if (applyResult.ok && applyResult.added) {
        creditedAmount = applyResult.added;
        if (quote === lastQuote) {
          markQuoteRedeemed(quote);
        }
      } else if (applyResult.reason === 'missing_output_datas') {
        showInfoMessage(t('messages.autoReflectFailed'), 'error', 6000);
      }
    }

    const creditedOrExpected = creditedAmount || amount;
    if (quote === lastQuote) {
      setReceivedAmount(creditedOrExpected);
    }

    console.log('[processPaymentNotification] creditedAmount:', creditedAmount, 'amount:', amount);

    // Always add transaction for received payment
    if (creditedAmount > 0) {
      console.log('[processPaymentNotification] Adding confirmed transaction with amount:', creditedAmount);
      addTransaction({
        id: Date.now(),
        type: 'receive',
        amount: creditedAmount,
        timestamp,
        status: 'confirmed',
        description: t('wallet.lightningReceive'),
        memo: detail?.memo || '',
        quoteId: quote,
        mintUrl
      });
    } else {
      console.log('[processPaymentNotification] Adding pending transaction with amount:', amount);
      addTransaction({
        id: Date.now(),
        type: 'receive',
        amount,
        timestamp,
        status: 'pending',
        description: t('wallet.lightningReceive'),
        memo: detail?.memo || '',
        quoteId: quote,
        mintUrl
      });
    }

    console.log('[processPaymentNotification] Loading wallet data...');
    await loadWalletData();
    console.log('[processPaymentNotification] Completed');
  }, [addTransaction, applyRedeemedSignatures, closeQrModal, isReceiveView, loadWalletData, markQuoteRedeemed, stopAutoRedeem, mintUrl, t]);

  // Polling function to check invoice status
  const startInvoicePolling = useCallback((quoteId, amount) => {
    console.log('[startInvoicePolling] Starting poll for quote:', quoteId);

    // Set up polling to check for payment status for up to 3 minutes (180 seconds)
    // Check every 3 seconds (3000ms), so that's 60 polls max
    const MAX_POLLS = 60;
    let pollCount = 0;
    let isPollingActive = true;

    const pollForPayment = async () => {
      if (pollCount >= MAX_POLLS || !isPollingActive) {
        console.log('[startInvoicePolling] Polling stopped - max attempts reached or cancelled for quote:', quoteId);
        // Update UI to indicate polling has ended
        setCheckingPayment(false);

        // Show timeout message
        if (pollCount >= MAX_POLLS) {
          showInfoMessage(t('wallet.pollingTimeout'), 'warning', 8000);
        }
        return;
      }

      try {
        // Check quote state first
        const checkResp = await fetch(apiUrl(`/api/cashu/mint/quote/check?quote=${encodeURIComponent(quoteId)}&mintUrl=${encodeURIComponent(mintUrl)}`));
        if (checkResp.ok) {
          const quoteData = await checkResp.json();
          const state = (quoteData?.state || '').toUpperCase();
          console.log('[startInvoicePolling] Quote state:', state, 'for quote:', quoteId);

          if (state === 'PAID' || state === 'ISSUED') {
            // Payment completed! Get the result and process it
            const resultResp = await fetch(apiUrl(`/api/cashu/mint/result?quote=${quoteId}`));
            if (resultResp.ok) {
              const data = await resultResp.json();
              console.log('[startInvoicePolling] Payment completed for quote:', quoteId, data);

              // Stop polling
              isPollingActive = false;
              setCheckingPayment(false);

              // Process the payment notification
              window.dispatchEvent(new CustomEvent('payment_received', {
                detail: {
                  amount: data.amount,
                  quote: data.quote,
                  timestamp: data.timestamp,
                  signatures: data.signatures,
                  keysetId: data.keysetId,
                  memo: data.memo || ''
                }
              }));

              return;
            }
          }
        }
      } catch (error) {
        console.error('[startInvoicePolling] Error polling for quote:', quoteId, error);
        // Show error message on polling error
        isPollingActive = false;
        setCheckingPayment(false);
        showInfoMessage(t('wallet.pollingError'), 'error', 8000);
        return;
      }

      // Continue polling
      pollCount++;
      setTimeout(() => {
        if (isPollingActive) {
          pollForPayment();
        }
      }, 3000); // Poll every 3 seconds
    };

    // Start polling immediately
    pollForPayment();

    // Return a function to stop polling if needed
    return () => {
      isPollingActive = false;
      setCheckingPayment(false);
      console.log('[startInvoicePolling] Polling cancelled for quote:', quoteId);
    };
  }, [apiUrl, showInfoMessage, t]);

  const startEcashPolling = useCallback((requestId) => {
    if (!requestId) return () => {};
    if (ecashPollingRef.current) clearInterval(ecashPollingRef.current);

    const stopPolling = () => {
      if (ecashPollingRef.current) {
        clearInterval(ecashPollingRef.current);
        ecashPollingRef.current = null;
      }
    };

    const finalizeReceive = async ({ proofs, amount, mint = mintUrl, memo = '' }) => {
      addProofs(proofs, mint);
      addTransaction({
        id: Date.now(),
        type: 'receive',
        amount,
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        description: t('wallet.ecashReceive'),
        memo,
        mintUrl: mint
      });

      await loadWalletData();
      setReceiveCompleted(true);
      setReceivedAmount(amount);
      setLastReceiveMode('ecash');
      setCheckingPayment(false);

      localStorage.removeItem('cashu_last_ecash_request_id');
      localStorage.removeItem('cashu_last_ecash_request_amount');
      localStorage.removeItem('cashu_last_ecash_request_string');
      setEcashRequest('');
      setEcashRequestId(null);
      showInfoMessage(t('messages.ecashReceiveSuccess'), 'success');
    };

    setCheckingPayment(true);

    const pollNut18 = async () => {
      try {
        const resp = await fetch(apiUrl(`/api/payment-request/${encodeURIComponent(requestId)}?consume=true`));
        if (resp.ok) {
          const data = await resp.json();
          if (data.paid && Array.isArray(data.proofs) && data.proofs.length) {
            stopPolling();
            const amount = data.amount || data.proofs.reduce((sum, proof) => sum + (parseInt(proof?.amount, 10) || 0), 0);
            await finalizeReceive({
              proofs: data.proofs,
              amount,
              mint: data.mint || mintUrl,
              memo: data.memo || ''
            });
          }
        }
      } catch (error) {
        console.error('NUT-18 polling error:', error);
      }
    };

    pollNut18();
    ecashPollingRef.current = setInterval(pollNut18, 3000);
    return stopPolling;
  }, [addTransaction, loadWalletData, mintUrl, showInfoMessage, t]);

  const handleIncomingNostrPayment = useCallback(async ({ payload, event }) => {
    if (!payload || typeof payload !== 'object') return;
    const eventId = event?.id;
    if (eventId && nostrHandledEventsRef.current.has(eventId)) {
      return;
    }
    if (eventId) {
      nostrHandledEventsRef.current.add(eventId);
    }

    const tokenProofs = Array.isArray(payload.token) && payload.token[0]?.proofs
      ? payload.token[0].proofs
      : [];
    const proofs = Array.isArray(payload.proofs) && payload.proofs.length
      ? payload.proofs
      : Array.isArray(tokenProofs) ? tokenProofs : [];

    if (!proofs.length || (payload.unit !== undefined && payload.unit !== 'sat')) {
      return;
    }
    const mintFromToken = Array.isArray(payload.token) ? payload.token[0]?.mint : null;
    const mintForProofs = payload.mint || mintFromToken || mintUrl;
    const creditedAmount = proofs.reduce((sum, p) => sum + (parseInt(p?.amount, 10) || 0), 0);

    addProofs(proofs, mintForProofs);
    addTransaction({
      id: Date.now(),
      type: 'receive',
      amount: creditedAmount,
      timestamp: new Date().toISOString(),
      status: 'confirmed',
      description: t('wallet.ecashReceive'),
      memo: payload.memo || '',
      mintUrl: mintForProofs,
      sender: event?.pubkey
    });

    await loadWalletData();
    setReceiveCompleted(true);
    setReceivedAmount(creditedAmount);
    setLastReceiveMode('ecash');
    if (payload.id && payload.id === ecashRequestId) {
      setEcashRequestId(null);
      setEcashRequest('');
      setCheckingPayment(false);
      localStorage.removeItem('cashu_last_ecash_request_id');
      localStorage.removeItem('cashu_last_ecash_request_amount');
      localStorage.removeItem('cashu_last_ecash_request_string');
    }
    showInfoMessage(t('messages.ecashReceiveSuccess'), 'success');
  }, [addTransaction, ecashRequestId, loadWalletData, mintUrl, showInfoMessage, t]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;

    const setupNostr = async () => {
      try {
        const identity = await ensureNostrIdentity();
        if (cancelled) return;
        setNostrIdentity(identity);
        setNostrError('');
        unsubscribe = await subscribeToNostrDms({
          relays: identity.relays,
          onMessage: handleIncomingNostrPayment,
          onError: (err) => {
            console.error('[Nostr] Subscription error:', err);
            setNostrError(err?.message || 'Nostr subscription failed');
          }
        });
        nostrSubscriptionRef.current = unsubscribe;
      } catch (error) {
        if (cancelled) return;
        console.error('[Nostr] Failed to initialize:', error);
        setNostrError(error?.message || 'Failed to initialize Nostr');
      }
    };

    setupNostr();

    return () => {
      cancelled = true;
      try { if (unsubscribe) unsubscribe(); } catch {}
      nostrSubscriptionRef.current = null;
    };
  }, [handleIncomingNostrPayment]);

  useEffect(() => {
    if (nostrError) {
      showInfoMessage(nostrError, 'error');
    }
  }, [nostrError, showInfoMessage]);

  useEffect(() => {
    // Auto-connect to mint on mount
    connectMint();

    // Check for pending quote
    (async () => {
      try {
        const lastQuote = localStorage.getItem('cashu_last_quote');
        if (lastQuote) {
          await ensurePendingMint(lastQuote);
        }
      } catch (err) {
        console.error('Failed to initialize pending invoice:', err);
      }
    })();

    // Removed: Auto-restore of pending eCash/NUT-18 request to prevent showing previous request on page load

    const handler = (event) => {
      console.log('[payment_received EVENT] Received payment_received event:', event);
      console.log('[payment_received EVENT] Event detail:', event?.detail);
      if (!event?.detail) {
        console.warn('[payment_received EVENT] No detail in event, ignoring');
        return;
      }
      console.log('[payment_received EVENT] Calling processPaymentNotification...');
      processPaymentNotification(event.detail).catch((err) => {
        console.error('[payment_received EVENT] Failed to handle payment notification:', err);
      });
    };

    window.addEventListener('payment_received', handler);
      console.log('[payment_received EVENT] Event listener registered');

      return () => {
        try { stopAutoRedeem(); } catch {}
        window.removeEventListener('payment_received', handler);
      };
  }, [connectMint, ensurePendingMint, processPaymentNotification, stopAutoRedeem, isReceiveView]);
  


  // Handle page visibility change (app resuming from background)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden || !isReceiveView || !checkingPayment) {
        return;
      }

      // App came back to foreground while waiting for payment
      console.log('App resumed, checking payment status...');

      try {
        // Check if waiting for Lightning invoice
        const lastQuote = localStorage.getItem('cashu_last_quote');
        if (!lastQuote) return;

        // Check if payment was completed on server
        try {
          const resultResp = await fetch(apiUrl(`/api/cashu/mint/result?quote=${lastQuote}`));
          if (resultResp.ok) {
            const data = await resultResp.json();
            console.log('Payment completed while app was in background:', data);

            // Stop current polling before processing
            if (pollingCancelRef.current) {
              pollingCancelRef.current();
              pollingCancelRef.current = null;
            }

            // Process the payment notification
            await processPaymentNotification(data);

            // Set state to reflect that payment has been processed
            setCheckingPayment(false);
            return;
          }
        } catch (error) {
          console.error('Error fetching payment result on resume:', error);
        }

        // Check if there's still a valid quote to poll for
        const checkResp = await fetch(apiUrl(`/api/cashu/mint/quote/check?quote=${lastQuote}&mintUrl=${encodeURIComponent(mintUrl)}`));
        if (checkResp.ok) {
          const quoteData = await checkResp.json();
          const state = (quoteData?.state || '').toUpperCase();

          if (state !== 'UNPAID') {
            // If the quote is no longer unpaid, stop polling
            if (pollingCancelRef.current) {
              pollingCancelRef.current();
              pollingCancelRef.current = null;
            }
            setCheckingPayment(false);
          } else {
            // Quote still unpaid; restart polling since background timers may have been paused
            if (pollingCancelRef.current) {
              pollingCancelRef.current();
              pollingCancelRef.current = null;
            }
            const lastAmountRaw = localStorage.getItem('cashu_last_mint_amount');
            const lastAmount = Number.parseInt(lastAmountRaw || '0', 10);
            console.log('Payment still pending after resume, restarting polling...');
            pollingCancelRef.current = startInvoicePolling(lastQuote, Number.isFinite(lastAmount) && lastAmount > 0 ? lastAmount : undefined);
            setCheckingPayment(true);
          }
        }
      } catch (error) {
        console.error('Error checking payment status on resume:', error);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isReceiveView, checkingPayment, mintUrl, processPaymentNotification, startInvoicePolling, receiveAmount]);

  // Sync mintUrl from settings when page becomes visible
  useEffect(() => {
    const handleFocus = () => {
      try {
        const settings = JSON.parse(localStorage.getItem('app_settings') || '{}');
        const savedMintUrl = settings.mintUrl || DEFAULT_MINT_URL;
        if (savedMintUrl !== mintUrl) {
          console.log('Mint URL changed in settings, updating:', savedMintUrl);
          setMintUrl(savedMintUrl);
        }
      } catch (err) {
        console.error('Failed to sync mintUrl from settings:', err);
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [mintUrl]);

  // Stop polling when invoice/ecashRequest is cleared
  useEffect(() => {
    // If both invoice and ecashRequest are cleared, stop any active polling
    if (!invoice && !ecashRequest && pollingCancelRef.current) {
      console.log('[Invoice/Request cleared] Stopping polling');
      if (pollingCancelRef.current) {
        pollingCancelRef.current();
        pollingCancelRef.current = null;
      }
      setCheckingPayment(false);
    }
  }, [invoice, ecashRequest]);

  // Handle page unload/navigation - only set up once
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pollingCancelRef.current) {
        console.log('[Page unloading] Stopping polling');
        pollingCancelRef.current();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup on actual unmount only
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      console.log('[Component unmounting] Cleaning up');
      if (pollingCancelRef.current) {
        pollingCancelRef.current();
        pollingCancelRef.current = null;
      }
    };
  }, []); // Empty dependency - only run once on mount/unmount


  // Encryption utilities using Web Crypto API
  const encryptData = async (plaintext, passphraseStr) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Derive key from passphrase
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphraseStr),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    // Combine salt + iv + ciphertext
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Return base64
    return btoa(String.fromCharCode(...result));
  };

  const decryptData = async (encryptedBase64, passphraseStr) => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Decode base64
    const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

    // Extract salt, iv, ciphertext
    const salt = encryptedData.slice(0, 16);
    const iv = encryptedData.slice(16, 28);
    const ciphertext = encryptedData.slice(28);

    // Derive key
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphraseStr),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return decoder.decode(decrypted);
  };

  const handleBackup = () => {
    setPassphraseAction('backup');
    setPassphrase('');
    setPassphraseConfirm('');
    setShowPassphraseModal(true);
  };

  const executeBackup = async () => {
    if (!passphrase || passphrase.length < 8) {
      showInfoMessage(t('messages.passphraseMinLength'), 'error');
      return;
    }
    if (passphrase !== passphraseConfirm) {
      showInfoMessage(t('messages.passphraseMismatch'), 'error');
      return;
    }

    try {
      setLoading(true);
      const json = exportProofsJson(true);
      const encrypted = await encryptData(json, passphrase);

      const backupData = {
        version: '1.0.0',
        encrypted: true,
        data: encrypted,
        timestamp: new Date().toISOString()
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json;charset=utf-8' });
      const ts = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const fname = `hanib-wallet-encrypted-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);

      setShowPassphraseModal(false);
      setPassphrase('');
      setPassphraseConfirm('');
      showInfoMessage(t('messages.backupDownloaded'), 'success');
      try { localStorage.setItem('cashu_backup_dismissed', '1'); setShowBackupBanner(false); } catch {}
    } catch (e) {
      console.error('Backup failed:', e);
      showInfoMessage(t('messages.backupFailed', { error: translateErrorMessage(e.message) }), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreFile = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      // Check if encrypted
      if (parsed.encrypted && parsed.data) {
        // Need passphrase
        setPassphraseAction('restore');
        setPassphrase('');
        setShowPassphraseModal(true);

        // Store file data for later
        window._pendingRestoreData = parsed.data;
      } else {
        // Legacy unencrypted backup
        const { added, total } = importProofsFrom(text);
        setEcashBalance(getBalanceSats());
        showInfoMessage(t('messages.restoreComplete', { added, total }), 'success');
      }
    } catch (e) {
      console.error('Restore failed:', e);
      showInfoMessage(t('messages.restoreInvalidFile'), 'error');
    } finally {
      try { e.target.value = ''; } catch {}
    }
  };

  const executeRestore = async () => {
    if (!passphrase) {
      showInfoMessage(t('messages.enterPassphrase'), 'error');
      return;
    }

    try {
      setLoading(true);
      const encryptedData = window._pendingRestoreData;
      if (!encryptedData) {
        throw new Error(t('messages.noDataToRestore'));
      }

      const decrypted = await decryptData(encryptedData, passphrase);
      const { added, total } = importProofsFrom(decrypted);
      setEcashBalance(getBalanceSats());

      setShowPassphraseModal(false);
      setPassphrase('');
      window._pendingRestoreData = null;
      showInfoMessage(t('messages.restoreComplete', { added, total }), 'success');
    } catch (e) {
      console.error('Restore failed:', e);
      showInfoMessage(t('messages.restoreWrongPassphrase'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendQrScan = useCallback((rawValue) => {
    const normalized = normalizeQrValue(rawValue);
    if (!normalized) {
      showInfoMessage(t('messages.qrCodeInvalid'), 'error', 3000);
      return;
    }
    setSendAddress(normalized);
    setEnableSendScanner(false);
    showInfoMessage(t('messages.qrCodeLoaded'), 'info', 2500);
  }, [showInfoMessage, t]);

  const handleSendQrError = useCallback((err) => {
    console.error('QR scanner error:', err);
    const message = err && err.message ? translateErrorMessage(err.message) : t('messages.qrScanUnavailable');
    showInfoMessage(message, 'error', 3500);
  }, [showInfoMessage, t, translateErrorMessage]);

  const handleTokenQrScan = useCallback((rawValue) => {
    const normalized = normalizeQrValue(rawValue);
    if (!normalized) {
      showInfoMessage(t('messages.qrCodeInvalid'), 'error', 3000);
      return;
    }
    setEcashTokenInput(normalized);
    setEnableTokenScanner(false);
    showInfoMessage(t('messages.qrCodeLoaded'), 'info', 2500);
  }, [showInfoMessage, t]);

  const handleTokenQrError = useCallback((err) => {
    console.error('QR scanner error:', err);
    const message = err && err.message ? translateErrorMessage(err.message) : t('messages.qrScanUnavailable');
    showInfoMessage(message, 'error', 3500);
  }, [showInfoMessage, t, translateErrorMessage]);

  const handleReceiveToken = useCallback(async () => {
    try {
      setLoading(true);
      setInvoiceError('');

      const trimmedToken = ecashTokenInput.trim();
      if (!trimmedToken) {
        throw new Error(t('messages.tokenRequired'));
      }

      if (!isCashuToken(trimmedToken)) {
        throw new Error(t('messages.invalidTokenFormat'));
      }

      // Parse token
      const parsedToken = parseCashuToken(trimmedToken);
      const { proofs, totalAmount, mint, memo } = extractProofsFromToken(parsedToken);

      if (!proofs || proofs.length === 0) {
        throw new Error(t('messages.noProofsInToken'));
      }

      console.log(`[Token Receive] Received ${proofs.length} proofs, total ${totalAmount} sats`);
      console.log(`[Token Receive] Starting swap to claim the token...`);

      // Swap received proofs for new ones to claim the token
      // This ensures the sender can't double-spend and their wallet shows "sent"
      try {
        // Get mint keys
        const keysResp = await fetch(`${API_BASE_URL}/api/cashu/keys?mintUrl=${encodeURIComponent(mint)}`);
        if (!keysResp.ok) throw new Error('Failed to fetch mint keys');
        const mintKeys = await keysResp.json();

        // Create new blinded outputs for the same amount
        const { outputs, outputDatas } = await createBlindedOutputs(totalAmount, mintKeys);

        // Swap the received proofs for new ones
        const normalizedProofs = normalizeProofsForApi(proofs);
        const swapResp = await fetch(`${API_BASE_URL}/api/cashu/swap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputs: normalizedProofs,
            outputs,
            mintUrl: mint
          })
        });

        if (!swapResp.ok) {
          const err = await swapResp.json();
          throw new Error(err?.error || 'Swap failed');
        }

        const swapResult = await swapResp.json();
        const signatures = swapResult?.signatures || swapResult?.promises || [];

        if (!Array.isArray(signatures) || signatures.length === 0) {
          throw new Error('No signatures received from swap');
        }

        // Convert signatures to new proofs
        const newProofs = await signaturesToProofs(signatures, mintKeys, outputDatas);

        console.log(`[Token Receive] Swap successful! Got ${newProofs.length} new proofs`);

        // Add the new proofs to wallet (not the old ones)
        addProofs(newProofs, mint);
      } catch (swapError) {
        console.error('[Token Receive] Swap failed:', swapError);
        // Fallback: add original proofs as DISABLED with reason
        console.log('[Token Receive] Fallback: adding original proofs as disabled (swap failed)');

        const disabledProofs = proofs.map(p => ({
          ...p,
          disabled: true,
          disabledReason: 'swap_failed',
          disabledMessage: swapError?.message || 'Swap failed',
          disabledAt: new Date().toISOString()
        }));

        addProofs(disabledProofs, mint);

        // Show warning to user
        showInfoMessage(t('messages.tokenReceivedButSwapFailed'), 'warning');
      }

      const newBalance = getBalanceSats();
      setEcashBalance(newBalance);

      // Add transaction record
      addTransaction({
        id: Date.now(),
        type: 'receive',
        amount: totalAmount,
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        description: t('wallet.ecashReceive'),
        memo: memo || '',
        mintUrl: mint
      });

      await loadWalletData();

      // Clear input
      setEcashTokenInput('');
      setReceiveCompleted(true);
      setReceivedAmount(totalAmount);
      setLastReceiveMode('token');

      showInfoMessage(t('messages.tokenReceivedSuccess', { amount: totalAmount }), 'success');

      console.log(`[Token Receive] Successfully received ${totalAmount} sats from token`);
    } catch (error) {
      console.error('Failed to receive token:', error);
      const errorMessage = translateErrorMessage(error?.message) || t('messages.tokenReceiveFailed');
      setInvoiceError(errorMessage);
      showInfoMessage(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  }, [ecashTokenInput, addProofs, getBalanceSats, setEcashBalance, addTransaction, loadWalletData, showInfoMessage, t, translateErrorMessage]);

  // Retry swap for failed proofs
  const retrySwap = useCallback(async (proof) => {
    if (!proof || !proof.disabled || proof.disabledReason !== 'swap_failed') {
      showInfoMessage(t('messages.invalidProofForRetry'), 'error');
      return;
    }

    setLoading(true);
    try {
      const mint = proof.mintUrl || mintUrl;
      const amount = Number(proof.amount || 0);

      console.log(`[Retry Swap] Attempting to swap proof: ${amount} sats from ${mint}`);

      // Get mint keys
      const keysResp = await fetch(`${API_BASE_URL}/api/cashu/keys?mintUrl=${encodeURIComponent(mint)}`);
      if (!keysResp.ok) throw new Error('Failed to fetch mint keys');
      const mintKeys = await keysResp.json();

      // Create new blinded outputs
      const { outputs, outputDatas } = await createBlindedOutputs(amount, mintKeys);

      // Remove disabled/mintUrl/createdAt/etc fields before swap
      const cleanProof = {
        amount: proof.amount,
        secret: proof.secret,
        C: proof.C
      };
      if (proof.id) cleanProof.id = proof.id;
      if (proof.witness) {
        cleanProof.witness = typeof proof.witness === 'object'
          ? JSON.stringify(proof.witness)
          : proof.witness;
      }
      if (proof.dleq) {
        cleanProof.witness = typeof proof.dleq === 'object'
          ? JSON.stringify(proof.dleq)
          : proof.dleq;
      }

      // Swap the proof
      const swapResp = await fetch(`${API_BASE_URL}/api/cashu/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [cleanProof],
          outputs,
          mintUrl: mint
        })
      });

      if (!swapResp.ok) {
        const err = await swapResp.json();
        throw new Error(err?.error || 'Swap failed');
      }

      const swapResult = await swapResp.json();
      const signatures = swapResult?.signatures || swapResult?.promises || [];

      if (!Array.isArray(signatures) || signatures.length === 0) {
        throw new Error('No signatures received from swap');
      }

      // Convert signatures to proofs
      const newProofs = await signaturesToProofs(signatures, mintKeys, outputDatas);

      console.log(`[Retry Swap] Swap successful, got ${newProofs.length} new proofs`);

      // Remove old disabled proof and add new ones
      removeProofs([proof], mint);
      addProofs(newProofs, mint);

      // Refresh balance
      const newBalance = getBalanceSats();
      setEcashBalance(newBalance);
      await loadWalletData();

      showInfoMessage(t('messages.swapRetrySuccess', { amount }), 'success');
    } catch (error) {
      console.error('[Retry Swap] Failed:', error);
      showInfoMessage(t('messages.swapRetryFailed') + ': ' + (error?.message || 'Unknown error'), 'error');
    } finally {
      setLoading(false);
    }
  }, [mintUrl, showInfoMessage, t, setLoading, removeProofs, addProofs, getBalanceSats, setEcashBalance, loadWalletData]);

  const handleReceiveAmountChange = useCallback((value) => {
    setReceiveAmount(value);
    if (!value) {
      setReceiveAmountTooLow(false);
      setReceiveAmountTooHigh(false);
      return;
    }

    const numeric = parseInt(value, 10);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
      setReceiveAmountTooLow(false);
      setReceiveAmountTooHigh(false);
      return;
    }

    setReceiveAmountTooLow(numeric > 0 && numeric < RECEIVE_MIN_AMOUNT);
    setReceiveAmountTooHigh(numeric > RECEIVE_MAX_AMOUNT);
  }, []);

  const handleEcashKeypadPress = useCallback((value) => {
    setEcashSendError('');
    if (ecashSendToken) {
      setEcashSendToken('');
      setEcashSendTokenAmount(0);
      setEcashSendTokenMint('');
      setEcashTokenCopied(false);
    }

    setEcashSendAmountInput((prev) => {
      const current = prev || '';
      if (value === 'clear') {
        return '';
      }
      if (value === 'del') {
        return current.slice(0, -1);
      }
      if (value === '00') {
        if (!current) return '';
        const nextDoubleZero = (current + '00').slice(0, ECASH_SEND_MAX_DIGITS);
        return nextDoubleZero;
      }
      if (/^\d$/.test(value)) {
        const target = (current === '0' ? '' : current) + value;
        const trimmed = target.replace(/^0+(?=\d)/, '');
        return trimmed.slice(0, ECASH_SEND_MAX_DIGITS) || value;
      }
      return current;
    });
  }, [ecashSendToken]);

  const handleResetEcashToken = useCallback(() => {
    setEcashSendToken('');
    setEcashSendTokenAmount(0);
    setEcashSendTokenMint('');
    setEcashTokenCopied(false);
    setEcashSendError('');
  }, []);

  const normalizeMintForCompare = useCallback((url) => {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  }, []);

  const getSwapFeeHint = useCallback((url) => {
    if (!url) return 0;
    const key = normalizeMintForCompare(url);
    if (!key) return 0;
    const value = swapFeeHintsRef.current[key];
    return typeof value === 'number' && value > 0 ? value : 0;
  }, [normalizeMintForCompare]);

  const rememberSwapFeeHint = useCallback((url, fee) => {
    if (!url || typeof fee !== 'number' || Number.isNaN(fee) || fee < 0) return;
    const key = normalizeMintForCompare(url);
    if (!key) return;
    swapFeeHintsRef.current[key] = fee;
  }, [normalizeMintForCompare]);

  const extractSwapFeeFromError = useCallback((payload) => {
    if (!payload) return null;
    if (typeof payload.fee === 'number') return payload.fee;
    if (typeof payload.fees === 'number') return payload.fees;
    const texts = [];
    const pushIfString = (value) => {
      if (typeof value === 'string' && value.trim()) {
        texts.push(value);
      }
    };
    pushIfString(payload.detail);
    pushIfString(payload.error);
    pushIfString(payload.message);
    if (typeof payload === 'string') {
      pushIfString(payload);
    }
    for (const text of texts) {
      const match = text.match(/fees?\s*(?:\(|:)?\s*(\d+)/i);
      if (match) {
        const parsed = Number(match[1]);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  }, []);

  const parseJsonSafely = useCallback(async (resp) => {
    try {
      return await resp.json();
    } catch {
      return null;
    }
  }, []);

  const handleGenerateEcashToken = useCallback(async () => {
    const amount = parseInt(ecashSendAmountInput || '0', 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setEcashSendError(t('messages.enterValidAmount'));
      return;
    }

    const estimatedFee = getSwapFeeHint(mintUrl);
    if (amount + estimatedFee > ecashBalance) {
      const errMsg = t('messages.insufficientBalance');
      setEcashSendError(errMsg);
      showInfoMessage(errMsg, 'error');
      return;
    }

    setLoading(true);
    setEcashSendError('');
    setEcashTokenCopied(false);

    const attemptTokenGeneration = async (feeReserve = estimatedFee, attempt = 1) => {
      const normalizedFee = Number(feeReserve) > 0 ? Number(feeReserve) : 0;
      const requiredTotal = amount + normalizedFee;

      const selection = selectProofsForAmount(requiredTotal);
      if (!selection.ok || !Array.isArray(selection.picked) || selection.picked.length === 0) {
        throw new Error(t('messages.insufficientBalance'));
      }

      const uniquePicked = selection.picked;
      const mintCandidates = Array.from(new Set(uniquePicked.map((p) => (p?.mintUrl || '').trim()).filter(Boolean)));
      if (mintCandidates.length > 1) {
        throw new Error(t('messages.ecashTokenMultipleMints'));
      }
      const targetMintUrl = mintCandidates[0] || mintUrl;
      if (!targetMintUrl) {
        throw new Error(t('messages.mintUnknown'));
      }

      const keysResp = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(targetMintUrl)}`));
      if (!keysResp.ok) {
        throw new Error(t('messages.mintKeysFailed'));
      }
      const mintKeys = await keysResp.json();

      const paymentOutputs = await createBlindedOutputs(amount, mintKeys);
      const changeAmount = Math.max(0, selection.total - amount - normalizedFee);
      const changeOutputs = changeAmount > 0
        ? await createBlindedOutputs(changeAmount, mintKeys)
        : { outputs: [], outputDatas: [] };
      const combinedOutputs = [...paymentOutputs.outputs, ...changeOutputs.outputs];
      const combinedOutputDatas = [...paymentOutputs.outputDatas, ...changeOutputs.outputDatas];
      const normalizedInputs = normalizeProofsForApi(uniquePicked);

      const swapResp = await fetch(apiUrl('/api/cashu/swap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: normalizedInputs,
          outputs: combinedOutputs,
          mintUrl: targetMintUrl
        })
      });

      if (!swapResp.ok) {
        const errJson = await parseJsonSafely(swapResp);
        const parsedFee = extractSwapFeeFromError(errJson);
        if (parsedFee !== null && parsedFee !== normalizedFee && attempt < 3) {
          rememberSwapFeeHint(targetMintUrl, parsedFee);
          return attemptTokenGeneration(parsedFee, attempt + 1);
        }

        let errorMessage = t('messages.ecashTokenCreateFailed');
        if (errJson?.error) {
          const translated = translateErrorMessage(errJson.error);
          if (translated) {
            errorMessage = translated;
          } else {
            errorMessage = errJson.error;
          }
        } else if (errJson?.detail) {
          errorMessage = translateErrorMessage(errJson.detail) || errJson.detail;
        }
        throw new Error(errorMessage);
      }

      const swapData = await swapResp.json();
      const signatures = swapData?.signatures || swapData?.promises || [];
      if (!Array.isArray(signatures) || signatures.length === 0) {
        throw new Error(t('messages.ecashTokenCreateFailed'));
      }

      const allProofs = await signaturesToProofs(signatures, mintKeys, combinedOutputDatas);
      const paymentProofCount = paymentOutputs.outputDatas.length;
      const paymentProofs = allProofs.slice(0, paymentProofCount);
      const changeProofs = allProofs.slice(paymentProofCount);

      removeProofs(uniquePicked, targetMintUrl);
      if (changeProofs.length) {
        addProofs(changeProofs, targetMintUrl);
      }

      const token = createCashuToken({
        mint: targetMintUrl,
        proofs: paymentProofs,
        unit: 'sat'
      });

      setEcashSendToken(token);
      setEcashSendTokenAmount(amount);
      setEcashSendTokenMint(targetMintUrl);
      setEcashSendAmountInput('');
      setEcashBalance(getBalanceSats());

      addTransaction({
        id: Date.now(),
        type: 'send',
        amount,
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        description: t('wallet.ecashSend'),
        memo: t('wallet.ecashTokenMemo'),
        mintUrl: targetMintUrl
      });

      showInfoMessage(t('messages.ecashTokenReady', { amount: formatAmount(amount) }), 'success');
    };

    try {
      await attemptTokenGeneration(getSwapFeeHint(mintUrl));
    } catch (error) {
      console.error('Failed to create eCash token:', error);
      const fallback = translateErrorMessage(error?.message) || t('messages.ecashTokenCreateFailed');
      setEcashSendError(fallback);
      showInfoMessage(fallback, 'error');
    } finally {
      setLoading(false);
    }
  }, [
    addTransaction,
    ecashBalance,
    ecashSendAmountInput,
    extractSwapFeeFromError,
    formatAmount,
    getBalanceSats,
    getSwapFeeHint,
    mintUrl,
    parseJsonSafely,
    rememberSwapFeeHint,
    selectProofsForAmount,
    setEcashBalance,
    showInfoMessage,
    t,
    translateErrorMessage
  ]);

  const generateInvoice = async () => {
    if (!receiveAmount) {
      showInfoMessage(t('messages.enterValidAmount'), 'error');
      return;
    }

    const amount = parseInt(receiveAmount, 10);
    if (!Number.isFinite(amount) || Number.isNaN(amount) || amount <= 0) {
      showInfoMessage(t('messages.enterValidAmount'), 'error');
      return;
    }

    if (amount < RECEIVE_MIN_AMOUNT) {
      setReceiveAmountTooLow(true);
      showInfoMessage(t('wallet.receiveAmountMinimum', { amount: RECEIVE_MIN_AMOUNT }), 'error');
      return;
    }

    if (amount > RECEIVE_MAX_AMOUNT) {
      setReceiveAmountTooHigh(true);
      showInfoMessage(t('wallet.receiveAmountMaximum', { amount: RECEIVE_MAX_AMOUNT }), 'error');
      return;
    }

    try {
      setLoading(true);
      setQrLoaded(false);
      setReceiveCompleted(false);
      setCheckingPayment(false);
      setInvoiceError(''); // Clear any previous errors
      
      // Get mint keys and create blinded outputs first
      const keysResp = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl)}`));
      if (!keysResp.ok) throw new Error(t('messages.mintKeysFailed'));
      const mintKeys = await keysResp.json();
      const { outputs, outputDatas } = await createBlindedOutputs(amount, mintKeys);

      // Create quote with outputs - server will start monitoring automatically
      const resp = await fetch(apiUrl('/api/cashu/mint/quote'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, outputs, mintUrl })
      });
      if (!resp.ok) {
        let msg = t('messages.invoiceIssueFailed');
        try {
          const err = await resp.json();
          // Check for mint backend error (code 20000)
          if (err?.code === 20000) {
            const displayMintUrl = mintUrl.replace('https://', '').replace('http://', '');
            msg = t('messages.mintBackendError', { mintUrl: displayMintUrl });
          } else {
            if (err?.error) msg = translateErrorMessage(err.error);
            else if (err?.detail) msg = err.detail;
            if (err?.code) msg += ` ${t('messages.errorCodeSuffix', { code: err.code })}`;
          }
        } catch {}
        throw new Error(msg);
      }
      const data = await resp.json();
      const req = data?.request || data?.payment_request || '';
      const quoteId = data?.quote || data?.quote_id || '';

      // Cancel any existing polling before starting new one
      if (pollingCancelRef.current) {
        pollingCancelRef.current();
        pollingCancelRef.current = null;
      }

      setInvoice(req);
      if (quoteId && Array.isArray(outputDatas) && outputDatas.length) {
        savePendingMint(quoteId, outputDatas, amount);
      } else {
        clearPendingMint();
      }
      localStorage.setItem('cashu_last_quote', quoteId);
      localStorage.setItem('cashu_last_mint_amount', String(amount));
      
      // Start polling for payment status
      setCheckingPayment(true);
      pollingCancelRef.current = startInvoicePolling(quoteId, amount);
      
      console.log('[DEBUG] Invoice generated:', {
        quoteId,
        amount,
        hasOutputDatas: Array.isArray(outputDatas) && outputDatas.length > 0
      });
    } catch (error) {
      console.error('Failed to generate invoice:', error);
      // Show the actual error message on screen
      const errorMessage = error.message || t('messages.invoiceGenerationFailed');
      setInvoiceError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const generateEcashRequest = async () => {
    if (!receiveAmount) {
      showInfoMessage(t('messages.enterValidAmount'), 'error');
      return;
    }

    const amount = parseInt(receiveAmount, 10);
    if (!Number.isFinite(amount) || Number.isNaN(amount) || amount <= 0) {
      showInfoMessage(t('messages.enterValidAmount'), 'error');
      return;
    }

    if (amount < RECEIVE_MIN_AMOUNT) {
      setReceiveAmountTooLow(true);
      showInfoMessage(t('wallet.receiveAmountMinimum', { amount: RECEIVE_MIN_AMOUNT }), 'error');
      return;
    }

    if (amount > RECEIVE_MAX_AMOUNT) {
      setReceiveAmountTooHigh(true);
      showInfoMessage(t('wallet.receiveAmountMaximum', { amount: RECEIVE_MAX_AMOUNT }), 'error');
      return;
    }

    const createNut18Request = () => {
      const requestId = `nut18_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const transports = [
        createHttpPostTransport(`${API_BASE_URL}/api/payment-request/${requestId}`)
      ];
      if (nostrIdentity?.nprofile) {
        transports.push({
          t: 'nostr',
          a: nostrIdentity.nprofile
        });
      }

      const requestString = createPaymentRequest({
        id: requestId,
        amount,
        unit: 'sat',
        single_use: true,
        mints: [mintUrl],
        description: '',
        transports
      });

      return { requestId, requestString };
    };

    try {
      setLoading(true);
      setQrLoaded(false);
      setReceiveCompleted(false);
      setInvoiceError('');

      const { requestId, requestString } = createNut18Request();

      setEcashRequest(requestString);
      setEcashRequestId(requestId);
      setReceiveTab('ecash');
      setQrLoaded(true);
      setLastReceiveMode('ecash');

      localStorage.setItem('cashu_last_ecash_request_id', requestId);
      localStorage.setItem('cashu_last_ecash_request_amount', amount.toString());
      localStorage.setItem('cashu_last_ecash_request_string', requestString);

      startEcashPolling(requestId);

      console.log('[DEBUG] eCash request generated:', {
        amount,
        mintUrl,
        requestId
      });
    } catch (error) {
      console.error('Failed to generate eCash request:', error);
      const errorMessage = error.message || t('messages.ecashRequestGenerationFailed');
      setInvoiceError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const exitReceiveFlow = useCallback(() => {
    try { stopAutoRedeem(); } catch {}
    setCheckingPayment(false);
    setInvoice('');
    setEcashRequest('');
    setEcashRequestId(null);
    setReceiveCompleted(false);
    setReceivedAmount(0);
    setReceiveAmount('');
    setReceiveAmountTooLow(false);
    setReceiveTab('lightning'); // Reset to Lightning tab

    // Clear eCash request from localStorage
    localStorage.removeItem('cashu_last_ecash_request_id');
    localStorage.removeItem('cashu_last_ecash_request_amount');
    localStorage.removeItem('cashu_last_ecash_request_string');

    const target = receiveOriginRef.current || '/wallet';
    navigate(target, { replace: true });
  }, [navigate, stopAutoRedeem]);

  const handleReceiveNavigation = useCallback(() => {
    const origin = location.pathname || '/wallet';
    const fallback = origin === '/wallet/receive' ? '/wallet' : origin;
    receiveOriginRef.current = fallback;
    try { stopAutoRedeem(); } catch {}
    setInvoice('');
    setEcashRequest('');
    setEcashRequestId(null);
    setReceiveCompleted(false);
    setReceivedAmount(0);
    setCheckingPayment(false);
    setReceiveAmount('');
    setReceiveAmountTooLow(false);
    navigate('/wallet/receive', { state: { from: fallback } });
  }, [location.pathname, navigate, stopAutoRedeem]);

  const handleSendNavigation = useCallback(() => {
    const origin = location.pathname || '/wallet';
    const fallback = origin === '/wallet/send' ? '/wallet' : origin;
    sendOriginRef.current = fallback;
    setSendAmount('');
    setSendAddress('');
    setInvoiceQuote(null);
    setInvoiceError('');
    navigate('/wallet/send', { state: { from: fallback } });
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (!isReceiveView && wasReceiveViewRef.current) {
      // Stop any active polling when leaving receive view
      if (pollingCancelRef.current) {
        pollingCancelRef.current();
        pollingCancelRef.current = null;
      }
      
      try { stopAutoRedeem(); } catch {}
      setCheckingPayment(false);
      setInvoice('');
      setReceiveCompleted(false);
      setReceivedAmount(0);
      setLoading(false);
    }
    if (isReceiveView && !wasReceiveViewRef.current) {
      // Reset loading state when entering receive page
      setLoading(false);
    }
    wasReceiveViewRef.current = isReceiveView;
  }, [isReceiveView, stopAutoRedeem]);

  useEffect(() => {
    if (!isSendView) {
      setSendAmount('');
      setSendAddress('');
      setInvoiceQuote(null);
      setInvoiceError('');
      setEnableSendScanner(false);
    }
  }, [isSendView]);

  const isBolt11Invoice = (val) => {
    if (!val || typeof val !== 'string') return false;
    const s = val.trim().replace(/\s+/g, '').toLowerCase().replace(/^lightning:/, '');
    return s.startsWith('lnbc') || s.startsWith('lntb') || s.startsWith('lno');
  };

  const isEcashRequest = (val) => {
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim();
    return /^creqA/.test(trimmed);
  };

  const isLightningAddress = (val) => {
    if (!val || typeof val !== 'string') return false;
    const s = val.trim();
    return s.includes('@') || s.toLowerCase().startsWith('lnurl');
  };

  const normalizeBolt11 = (val) => {
    if (!val) return '';
    let s = String(val).trim();
    if (s.toLowerCase().startsWith('lightning:')) s = s.slice('lightning:'.length);
    return s.replace(/\s+/g, '').toLowerCase();
  };

  const isMeaninglessErrorCode = useCallback((value) => {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    return /^[0-9a-f]{8,}$/i.test(trimmed) || /^[0-9]{6,}$/.test(trimmed);
  }, []);

  const formatMintLabel = useCallback((url) => {
    if (!url || typeof url !== 'string') return t('messages.mintUnknown');
    const trimmed = url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return trimmed || t('messages.mintUnknown');
  }, [t]);

  const getMintMismatchMessage = useCallback((proofs) => {
    if (!Array.isArray(proofs) || proofs.length === 0) return '';
    const currentMint = normalizeMintForCompare(mintUrl);
    if (!currentMint) return '';
    const mismatch = proofs.find((p) => {
      const proofMint = normalizeMintForCompare(p?.mintUrl);
      if (!proofMint) return false;
      return proofMint !== currentMint;
    });
    if (!mismatch) return '';
    return t('messages.mintMismatchSend', {
      storedMint: formatMintLabel(mismatch?.mintUrl),
      currentMint: formatMintLabel(mintUrl),
    });
  }, [mintUrl, formatMintLabel, normalizeMintForCompare, t]);

  const buildLightningAddressErrorMessage = useCallback((err) => {
    const fallback = t('messages.addressInvoiceError');
    const providerFallback = t('messages.lightningAddressRejected');

    const candidates = [];
    if (err?.error) candidates.push(err.error);
    if (err?.reason) candidates.push(err.reason);

    for (const raw of candidates) {
      if (!raw) continue;
      const text = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw);
      if (!text) continue;

      const translated = translateErrorMessage(text);
      if (translated && translated !== text) {
        return translated;
      }

      if (isMeaninglessErrorCode(text)) {
        return `${providerFallback} (${t('messages.errorCodeSuffix', { code: text })})`;
      }

      return `${providerFallback}: ${text}`;
    }

    return fallback;
  }, [isMeaninglessErrorCode, t, translateErrorMessage]);

  // Auto-fetch quote when invoice is entered
  useEffect(() => {
    const fetchInvoiceQuote = async () => {
      if (!sendAddress || !isBolt11Invoice(sendAddress)) {
        setInvoiceQuote(null);
        setInvoiceError('');
        setFetchingQuote(false);
        return;
      }

      try {
        // Clear previous quote immediately when invoice changes
        setInvoiceQuote(null);
        setFetchingQuote(true);
        setInvoiceError('');
        const bolt11 = normalizeBolt11(sendAddress);

        const q = await fetch(apiUrl('/api/cashu/melt/quote'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: bolt11, invoice: bolt11, mintUrl })
        });

        if (!q.ok) {
          let msg = t('messages.invalidInvoice');
          try {
            const err = await q.json();
            if (err?.error) {
              // Try to extract meaningful error message
              let errorMsg = err.error;

              // If error is a JSON string, try to parse it
              if (typeof errorMsg === 'string') {
                try {
                  const inner = JSON.parse(errorMsg);
                  if (inner?.detail?.[0]?.msg) {
                    errorMsg = inner.detail[0].msg;
                  } else if (inner?.detail && typeof inner.detail === 'string') {
                    errorMsg = inner.detail;
                  } else if (inner?.message) {
                    errorMsg = inner.message;
                  }
                } catch {
                  // If parsing fails, use the string as-is
                }
              }

              // Check if error message is meaningless (hex string, very short, etc.)
              const isMeaningless = typeof errorMsg === 'string' && (
                /^[0-9a-f]{8,}$/i.test(errorMsg.trim()) || // Hex string
                errorMsg.trim().length < 3 || // Too short
                /^[0-9]+$/.test(errorMsg.trim()) // Just numbers
              );

              msg = isMeaningless ? t('messages.invalidInvoice') : errorMsg;
            } else if (err?.detail) {
              // Some errors come with detail field directly
              let detailMsg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);

              // Check if detail is meaningless
              const isMeaningless = typeof detailMsg === 'string' && (
                /^[0-9a-f]{8,}$/i.test(detailMsg.trim()) ||
                detailMsg.trim().length < 3 ||
                /^[0-9]+$/.test(detailMsg.trim())
              );

              msg = isMeaningless ? t('messages.invalidInvoice') : detailMsg;
            } else if (err?.message) {
              msg = err.message;
            }

            // Log error details for debugging
            if (err?.code !== undefined || err?.detail || err?.error) {
              console.error('Invoice quote error:', {
                code: err.code,
                detail: err.detail,
                error: err.error,
                displayMessage: msg
              });
            }
          } catch (parseErr) {
            console.error('Failed to parse error response:', parseErr);
          }
          setInvoiceError(translateErrorMessage(msg));
          setInvoiceQuote(null);
          setFetchingQuote(false);
          return;
        }

        const qd = await q.json();
        const invoiceAmount = Number(qd?.amount || 0);
        const feeReserve = Number(qd?.fee_reserve || qd?.fee || 0);
        const need = invoiceAmount + feeReserve;
        const available = getBalanceSats();

        if (available < need) {
          setInvoiceError(t('messages.insufficientBalanceDetails', { amount: formatAmount(need - available) }));
        }

        setInvoiceQuote({
          quoteData: qd,
          bolt11,
          invoiceAmount,
          feeReserve,
          need,
          available
        });
        setFetchingQuote(false);
      } catch (error) {
        console.error('Failed to request quote:', error);
        setInvoiceError(translateErrorMessage(error?.message) || t('messages.quoteRequestFailed'));
        setInvoiceQuote(null);
        setFetchingQuote(false);
      }
    };

    fetchInvoiceQuote();
  }, [sendAddress, formatAmount, mintUrl, t, translateErrorMessage]);

  // Send confirmation state
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const sendCtxRef = useRef(null); // { bolt11, quoteData }

  const handleNut18Send = useCallback(async (requestPayload) => {
    const {
      amount: rawAmount,
      mints: allowedMints = [],
      transports = [],
      unit = 'sat',
      id,
      description: memo = ''
    } = requestPayload;

    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(t('messages.invalidAmount'));
    }

    const transportList = Array.isArray(transports) ? transports : [];
    const getAddress = (t) => t?.a || t?.address || t?.url || '';
    const normalizedType = (t) => (t?.t || t?.type || '').toString().toLowerCase();
    const postTransport = transportList.find((transport) => {
      const type = normalizedType(transport);
      const address = getAddress(transport);
      const isHttpType = type === 'post' || type === 'http' || type === 'https';
      const isHttpUrl = typeof address === 'string' && /^https?:\/\//i.test(address.trim());
      return isHttpType || isHttpUrl;
    });
    const nostrTransport = transportList.find((transport) => {
      const type = normalizedType(transport);
      const address = getAddress(transport);
      return (type === 'nostr' || (!type && address)) && address;
    });

    const postEndpoint = (postTransport && getAddress(postTransport)) || '';
    const nostrEndpoint = (nostrTransport && getAddress(nostrTransport)) || '';

    if (Array.isArray(allowedMints) && allowedMints.length > 0) {
      const currentMint = normalizeMintForCompare(mintUrl);
      const allowed = allowedMints.some((allowedMint) => normalizeMintForCompare(allowedMint) === currentMint);
      if (!allowed) {
        const errorMsg = t('messages.ecashRequestMintMismatch', {
          requestMint: formatMintLabel(allowedMints[0]),
          currentMint: formatMintLabel(mintUrl)
        });
        setInvoiceError(errorMsg);
        showInfoMessage(errorMsg, 'error');
        throw new Error(errorMsg);
      }
    }

    const attemptNut18Send = async (feeReserve = getSwapFeeHint(mintUrl), attempt = 1) => {
      const feeValue = Number(feeReserve) > 0 ? Number(feeReserve) : 0;
      const required = amount + feeValue;
      const available = getBalanceSats();
      if (available < required) {
        throw new Error(t('messages.insufficientBalanceDetails', { amount: formatAmount(required - available) }));
      }

      const { ok, picked } = selectProofsForAmount(required);
      if (!ok) throw new Error(t('messages.insufficientBalance'));
      const mintMismatchMessage = getMintMismatchMessage(picked);
      if (mintMismatchMessage) {
        setInvoiceError(mintMismatchMessage);
        showInfoMessage(mintMismatchMessage, 'error');
        throw new Error(mintMismatchMessage);
      }
      const uniquePicked = Array.from(new Map(picked.map(p => [p?.secret || JSON.stringify(p), p])).values());

      const keysResp = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl)}`));
      if (!keysResp.ok) {
        throw new Error(t('messages.mintKeysFailed'));
      }
      const mintKeys = await keysResp.json();

      const actualInputTotal = uniquePicked.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      if (actualInputTotal < required) {
        throw new Error(t('messages.insufficientBalance'));
      }

      const paymentOutputs = await createBlindedOutputs(amount, mintKeys);
      const changeAmount = Math.max(0, actualInputTotal - Number(amount) - feeValue);
      const changeOutputs = changeAmount > 0 ? await createBlindedOutputs(changeAmount, mintKeys) : { outputs: [], outputDatas: [] };

      const combinedOutputs = [...paymentOutputs.outputs, ...changeOutputs.outputs];
      const combinedOutputDatas = [...paymentOutputs.outputDatas, ...changeOutputs.outputDatas];

      const normalizedInputs = normalizeProofsForApi(uniquePicked);
      const swapResp = await fetch(apiUrl('/api/cashu/swap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: normalizedInputs,
          outputs: combinedOutputs,
          mintUrl,
          requestId: id
        })
      });

      if (!swapResp.ok) {
        const err = await parseJsonSafely(swapResp);
        const parsedFee = extractSwapFeeFromError(err);
        if (parsedFee !== null && parsedFee !== feeValue && attempt < 3) {
          rememberSwapFeeHint(mintUrl, parsedFee);
          return attemptNut18Send(parsedFee, attempt + 1);
        }
        let msg = t('messages.ecashSendFailed');
        const errMessage = err?.error || err?.detail || err?.message;
        if (typeof errMessage === 'string' && errMessage.trim()) {
          msg = translateErrorMessage(errMessage);
        }
        throw new Error(msg);
      }

      const swapData = await swapResp.json();
      const signatures = swapData?.signatures || swapData?.promises || [];
      if (!signatures.length) {
        throw new Error(t('messages.ecashSendFailed'));
      }
      const allProofs = await signaturesToProofs(signatures, mintKeys, combinedOutputDatas);
      const paymentProofCount = paymentOutputs.outputDatas.length;
      const paymentProofs = allProofs.slice(0, paymentProofCount);
      const changeProofs = allProofs.slice(paymentProofCount);

      const paymentPayload = createPaymentPayload({
        id,
        memo,
        mint: mintUrl,
        unit: unit || 'sat',
        proofs: paymentProofs
      });

      try {
        if (postEndpoint) {
          await sendPaymentViaPost(postEndpoint, paymentPayload);
        } else if (nostrEndpoint) {
          await sendPaymentViaNostr({
            nprofile: nostrEndpoint,
            payload: paymentPayload
          });
        } else {
          throw new Error(t('messages.paymentRequestMissingTransport'));
        }
        removeProofs(uniquePicked, mintUrl);
        if (changeProofs.length) {
          addProofs(changeProofs, mintUrl);
        }
      } catch (error) {
        console.error('Payment transport failed:', error);
        removeProofs(uniquePicked, mintUrl);
        const fallbackProofs = [...paymentProofs, ...changeProofs];
        if (fallbackProofs.length) {
          addProofs(fallbackProofs, mintUrl);
        }
        throw error instanceof Error ? error : new Error(String(error));
      }

      addTransaction({
        id: Date.now(),
        type: 'send',
        amount,
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        description: t('wallet.ecashSend'),
        memo: memo || '',
        mintUrl
      });

      await loadWalletData();
      showInfoMessage(t('messages.ecashSendSuccess'), 'success');

      navigate('/wallet/payment-success', {
        state: {
          amount,
          type: 'ecash_send',
          from: '/wallet/send'
        },
        replace: true
      });
    };

    await attemptNut18Send(getSwapFeeHint(mintUrl));
  }, [
    addTransaction,
    extractSwapFeeFromError,
    formatAmount,
    formatMintLabel,
    getMintMismatchMessage,
    getSwapFeeHint,
    loadWalletData,
    mintUrl,
    navigate,
    normalizeMintForCompare,
    parseJsonSafely,
    rememberSwapFeeHint,
    setInvoiceError,
    showInfoMessage,
    t,
    translateErrorMessage
  ]);

  const handleEcashRequestSend = useCallback(async () => {
    try {
      setLoading(true);
      setInvoiceError('');

      const requestPayload = parseEcashRequest(sendAddress);
      if (!requestPayload) {
        throw new Error(t('messages.invalidEcashRequest'));
      }

      await handleNut18Send(requestPayload);
    } catch (error) {
      console.error('Failed to send eCash:', error);
      const errorMessage = translateErrorMessage(error?.message) || t('messages.ecashSendFailed');
      setInvoiceError(errorMessage);
      showInfoMessage(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  }, [handleNut18Send, parseEcashRequest, sendAddress, setInvoiceError, setLoading, showInfoMessage, t, translateErrorMessage]);

  const prepareSend = useCallback(async () => {
    if (enableSendScanner) {
      setEnableSendScanner(false);
    }

    // Clear previous error first
    setInvoiceError('');

    const hasInvoice = isBolt11Invoice(sendAddress);
    const hasAddress = isLightningAddress(sendAddress);
    const hasEcashRequest = isEcashRequest(sendAddress);

    if (!hasInvoice && !hasAddress && !hasEcashRequest) {
      setInvoiceError(t('messages.invoiceRequired'));
      return;
    }

    // Handle eCash request separately
    if (hasEcashRequest) {
      return handleEcashRequestSend();
    }

    try {
      setLoading(true);
      let quoteData, bolt11, invoiceAmount, feeReserve, need;

      // Use existing quote for invoice, or create new quote for address
      if (hasInvoice && invoiceQuote) {
        ({ quoteData, bolt11, invoiceAmount, feeReserve, need } = invoiceQuote);
      } else if (hasAddress) {
        const amt = parseInt(sendAmount, 10);
        if (!amt || amt <= 0) throw new Error(t('messages.amountRequired'));

        const rq = await fetch(apiUrl('/api/lightningaddr/quote'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: sendAddress, amount: amt })
        });

        if (!rq.ok) {
          let msg = t('messages.addressInvoiceError');
          try {
            const err = await rq.json();
            msg = buildLightningAddressErrorMessage(err);
          } catch {}
          throw new Error(msg);
        }

        const rqj = await rq.json();
        if (rqj && typeof rqj === 'object' && String(rqj.status || '').toUpperCase() === 'ERROR') {
          throw new Error(buildLightningAddressErrorMessage({
            error: rqj.reason || rqj.error || rqj.message,
            reason: rqj.reason || rqj.error || rqj.message,
          }));
        }
        bolt11 = rqj?.request;
        if (!bolt11) throw new Error(t('messages.invoiceIssueFailed'));

        const q = await fetch(apiUrl('/api/cashu/melt/quote'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: bolt11, invoice: bolt11, mintUrl })
        });

        if (!q.ok) throw new Error(t('messages.quoteError'));

        quoteData = await q.json();
        invoiceAmount = Number(quoteData?.amount || 0);
        feeReserve = Number(quoteData?.fee_reserve || quoteData?.fee || 0);
        need = invoiceAmount + feeReserve;
      } else {
        throw new Error(t('messages.invoiceOrAddressRequired'));
      }

      const available = getBalanceSats();
      if (available < need) {
        throw new Error(t('messages.insufficientBalanceDetails', { amount: formatAmount(need - available) }));
      }

      // Execute send directly
      const { ok, picked, total } = selectProofsForAmount(need);
      if (!ok) throw new Error(t('messages.insufficientBalance'));
      const mintMismatchMessage = getMintMismatchMessage(picked);
      if (mintMismatchMessage) {
        setInvoiceError(mintMismatchMessage);
        showInfoMessage(mintMismatchMessage, 'error');
        throw new Error(mintMismatchMessage);
      }

      let changeOutputs = undefined;
      let changeOutputDatas = undefined;
      const change = Math.max(0, Number(total) - Number(need));

      if (change > 0) {
        const kr = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl)}`));
        if (!kr.ok) throw new Error(t('messages.mintKeysFetchError'));
        const mintKeys = await kr.json();
        const built = await createBlindedOutputs(change, mintKeys);
        changeOutputs = built.outputs;
        changeOutputDatas = built.outputDatas;
      }

      const uniquePicked = Array.from(new Map(picked.map(p => [p?.secret || JSON.stringify(p), p])).values());
      const normalizedInputs = normalizeProofsForApi(uniquePicked);

      const m = await fetch(apiUrl('/api/cashu/melt'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote: quoteData?.quote || quoteData?.quote_id,
          inputs: normalizedInputs,
          outputs: changeOutputs,
          mintUrl
        })
      });

      if (!m.ok) {
        let msg = t('messages.sendFailed');
        try {
          const err = await m.json();
          if (err?.error) {
            const errorStr = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);

            // Check for "already spent" error
            if (/already spent|token.*spent/i.test(errorStr)) {
              msg = t('messages.tokenAlreadyUsed');
            } else {
              try {
                const inner = JSON.parse(err.error);
                if (inner?.code === 11007 || /duplicate inputs?/i.test(inner?.detail || '')) {
                  msg = t('messages.duplicateInputs');
                } else if (inner?.detail?.[0]?.msg) msg = translateErrorMessage(inner.detail[0].msg);
                else msg = translateErrorMessage(err.error);
              } catch { msg = translateErrorMessage(err.error); }
            }
          }
        } catch {}
        throw new Error(msg);
      }

      const md = await m.json();

      // 송금 성공 즉시 거래 내역 저장 (이후 작업이 실패해도 기록 남도록)
      addTransaction({
        id: Date.now(),
        type: 'send',
        amount: invoiceAmount,
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        description: t('wallet.lightningSend'),
        memo: '',
        mintUrl
      });

      let changeProofs = [];
      const signatures = md?.change || md?.signatures || md?.promises || [];

      if (Array.isArray(signatures) && signatures.length && changeOutputDatas) {
        const kr2 = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl)}`));
        const mintKeys2 = kr2.ok ? await kr2.json() : null;
        if (mintKeys2) {
          changeProofs = await signaturesToProofs(signatures, mintKeys2, changeOutputDatas);
        }
      }

      removeProofs(picked, mintUrl);
      if (changeProofs.length) addProofs(changeProofs, mintUrl);
      setEcashBalance(getBalanceSats());
      await loadWalletData();

      setSendAmount('');
      setSendAddress('');
      setShowSend(false);
      setEnableSendScanner(false);
      setInvoiceQuote(null);
      setInvoiceError('');

      // Wait a bit for state updates to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Navigate to success page
      navigate('/wallet/payment-success', {
        state: {
          amount: invoiceAmount,
          returnTo: '/wallet/send',
          type: 'send'
        }
      });
    } catch (error) {
      console.error('Failed to send payment:', error);
      const translatedMsg = translateErrorMessage(error?.message) || t('messages.sendFailed');
      setInvoiceError(translatedMsg);
      showInfoMessage(translatedMsg, 'error');
    } finally {
      setLoading(false);
    }
  }, [
    sendAddress,
    invoiceQuote,
    enableSendScanner,
    setEnableSendScanner,
    setInvoiceError,
    setLoading,
    t,
    addTransaction,
    loadWalletData,
    setEcashBalance,
    setSendAmount,
    setSendAddress,
    setShowSend,
    setInvoiceQuote,
    navigate,
    translateErrorMessage,
    formatAmount,
    mintUrl,
    getMintMismatchMessage,
    showInfoMessage,
    handleEcashRequestSend,
    buildLightningAddressErrorMessage,
    sendAmount
  ]);

  const [pendingSendDetails, setPendingSendDetails] = useState(null);
  
  // Ref to store the polling cancellation function
  const pollingCancelRef = useRef(null);

  const confirmSend = useCallback(async () => {
    try {
      setLoading(true);
      const { quoteData } = sendCtxRef.current || {};
      if (!quoteData) throw new Error(t('messages.quoteDataMissing'));
      const invoiceAmount = Number(quoteData?.amount || 0);
      const feeReserve = Number(quoteData?.fee_reserve || quoteData?.fee || 0);
      const need = invoiceAmount + feeReserve;
      const { ok, picked, total } = selectProofsForAmount(need);
      if (!ok) throw new Error(t('messages.insufficientBalance'));
      const mintMismatchMessage = getMintMismatchMessage(picked);
      if (mintMismatchMessage) {
        throw new Error(mintMismatchMessage);
      }
      // Prepare change outputs if necessary
      let changeOutputs = undefined;
      let changeOutputDatas = undefined;
      const change = Math.max(0, Number(total) - Number(need));
      if (change > 0) {
      const kr = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl)}`));
        if (!kr.ok) throw new Error(t('messages.mintKeysFetchError'));
        const mintKeys = await kr.json();
        const built = await createBlindedOutputs(change, mintKeys);
        changeOutputs = built.outputs;
        changeOutputDatas = built.outputDatas;
      }
      // Deduplicate inputs defensively
      const uniquePicked = Array.from(new Map(picked.map(p => [p?.secret || JSON.stringify(p), p])).values());
      const normalizedInputs = normalizeProofsForApi(uniquePicked);
      const m = await fetch(apiUrl('/api/cashu/melt'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote: quoteData?.quote || quoteData?.quote_id, inputs: normalizedInputs, outputs: changeOutputs, mintUrl })
      });
      if (!m.ok) {
        let msg = t('messages.sendFailed');
        try {
          const err = await m.json();
          if (err?.error) {
            const errorStr = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);

            // Check for "already spent" error
            if (/already spent|token.*spent/i.test(errorStr)) {
              msg = t('messages.tokenAlreadyUsed');
            } else {
              try {
                const inner = JSON.parse(err.error);
                if (inner?.code === 11007 || /duplicate inputs?/i.test(inner?.detail || '')) {
                  msg = t('messages.duplicateInputs');
                } else if (inner?.detail?.[0]?.msg) msg = translateErrorMessage(inner.detail[0].msg);
                else msg = translateErrorMessage(err.error);
              } catch { msg = translateErrorMessage(err.error); }
            }
          }
        } catch {}
        throw new Error(msg);
      }
      const md = await m.json();
      const sentAmount = pendingSendDetails?.invoiceAmount || 0;

      // 송금 성공 즉시 거래 내역 저장 (이후 작업이 실패해도 기록 남도록)
      addTransaction({
        id: Date.now(),
        type: 'send',
        amount: sentAmount,
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        description: t('wallet.lightningSend'),
        memo: '',
        mintUrl
      });

      // Process change promises if any
      let changeProofs = [];
      const signatures = md?.change || md?.signatures || md?.promises || [];
      if (Array.isArray(signatures) && signatures.length && changeOutputDatas) {
        const kr2 = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl)}`));
        const mintKeys2 = kr2.ok ? await kr2.json() : null;
        if (mintKeys2) {
          changeProofs = await signaturesToProofs(signatures, mintKeys2, changeOutputDatas);
        }
      }
      removeProofs(picked, mintUrl);
      if (changeProofs.length) addProofs(changeProofs, mintUrl);
      setEcashBalance(getBalanceSats());
      await loadWalletData();
      setSendAmount('');
      setSendAddress('');
      setShowSend(false);
      setEnableSendScanner(false);
      setShowSendConfirm(false);
      setPendingSendDetails(null);

      // Wait a bit for state updates to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Navigate to success page
      navigate('/wallet/payment-success', {
        state: {
          amount: sentAmount,
          returnTo: '/wallet/send',
          type: 'send'
        }
      });
    } catch (error) {
      console.error('Failed to send payment:', error);
      showInfoMessage(translateErrorMessage(error?.message) || t('messages.sendFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [
    sendCtxRef,
    t,
    addTransaction,
    loadWalletData,
    setEcashBalance,
    setSendAmount,
    setSendAddress,
    setShowSend,
    setEnableSendScanner,
    setShowSendConfirm,
    setPendingSendDetails,
    navigate,
    pendingSendDetails,
    translateErrorMessage,
    mintUrl,
    getMintMismatchMessage,
    showInfoMessage,
    setLoading
  ]);

  const convertFunds = useCallback(async () => {
    if (!convertAmount || convertAmount <= 0) {
      showInfoMessage(t('messages.enterValidAmount'), 'error');
      return;
    }

    const amount = parseInt(convertAmount);

    if (convertDirection === 'ecash_to_ln') {
      if (amount > ecashBalance) {
        showInfoMessage(t('messages.insufficientBalance'), 'error');
        return;
      }
    }

    if (amount > MAX_CONVERSION_AMOUNT) {
      showInfoMessage(t('messages.maxConversionAmount', { amount: formatAmount(MAX_CONVERSION_AMOUNT) }), 'error');
      return;
    }

    try {
      setLoading(true);
      // Cashu 모드에서는 받기/보내기 플로우로 전환이 처리됩니다.
      showInfoMessage(t('messages.cashuModeConversionNotAllowed'), 'info');
    } catch (error) {
      console.error('Failed to convert funds:', error);
    } finally {
      setLoading(false);
    }
  }, [convertAmount, convertDirection, ecashBalance, showInfoMessage, t, formatAmount, setLoading]);

  return (
    <div className="wallet-page">
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
      {isSendView ? (
        <div className="send-page">
          <div className="send-card">
            <div className="send-card-header">
              <h2><Icon name="send" size={20} /> {t('wallet.sendTitle')}</h2>
            </div>
            <div className="send-card-body">
              <div className="send-tabs">
                <button
                  className={`send-tab ${sendTab === 'lightning' ? 'active' : ''}`}
                  onClick={() => setSendTab('lightning')}
                >
                  <Icon name="bolt" size={14} /> {t('wallet.lightningTab')}
                </button>
                <button
                  className={`send-tab ${sendTab === 'ecash' ? 'active' : ''}`}
                  onClick={() => setSendTab('ecash')}
                >
                  <Icon name="coins" size={14} /> {t('wallet.ecashTab')}
                </button>
              </div>
              <div className="send-info">
                <Icon name="info" size={16} />
                {sendTab === 'ecash' ? t('wallet.sendViaEcash') : t('wallet.sendViaLightning')}
              </div>

              {sendTab === 'lightning' ? (
                <>
                  {!isConnected ? (
                    <div className="network-warning" style={{ marginBottom: '1rem' }}>
                      {networkDisconnectedMessage}
                    </div>
                  ) : null}
                  {enableSendScanner ? (
                    <div className="qr-scanner-section">
                      <QrScanner onScan={handleSendQrScan} onError={handleSendQrError} />
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setEnableSendScanner(false)}
                      >
                        {t('wallet.closeScanner')}
                      </button>
                    </div>
                  ) : (
                    <div className="qr-rescan">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setEnableSendScanner(true)}
                        disabled={!isConnected}
                      >
                        <Icon name="camera" size={16} /> {t('wallet.scanQR')}
                      </button>
                    </div>
                  )}
                  <div className="input-group">
                    <label>{t('wallet.lightningAddress')}</label>
                    <textarea
                      value={sendAddress}
                      onChange={(e) => setSendAddress(e.target.value)}
                      placeholder={t('wallet.invoicePlaceholder')}
                      rows="3"
                      disabled={!isConnected}
                    />
                    <small>
                      {isBolt11Invoice(sendAddress)
                        ? t('wallet.invoiceDetected')
                        : isEcashRequest(sendAddress)
                          ? t('wallet.ecashRequestDetected')
                          : isLightningAddress(sendAddress)
                            ? t('wallet.addressDetected')
                            : t('wallet.invoiceOrAddressHint')}
                    </small>
                  </div>
                  {isLightningAddress(sendAddress) && !isBolt11Invoice(sendAddress) && !isEcashRequest(sendAddress) && (
                    <div className="input-group">
                      <label>{t('wallet.amountToSend')}</label>
                      <input
                        type="number"
                        value={sendAmount}
                        onChange={(e) => setSendAmount(e.target.value)}
                        placeholder={t('wallet.amountPlaceholder')}
                        min="1"
                        max={ecashBalance}
                        disabled={!isConnected}
                      />
                      <small>{t('wallet.availableBalance', { amount: formatAmount(ecashBalance) })}</small>
                      {sendFiatDisplay && (
                        <div className="fiat-hint">
                          {t('wallet.fiatApprox', { value: sendFiatDisplay, source: rateSourceLabel })}
                        </div>
                      )}
                    </div>
                  )}
                  {isEcashRequest(sendAddress) && (() => {
                    const requestPayload = parseEcashRequest(sendAddress);
                    if (!requestPayload) return null;
                    const requestAmount = Number(requestPayload.amount || 0);
                    const requestFiatDisplay = fiatRate.rate ? formatFiatAmount(requestAmount) : null;
                    const requestMemo = requestPayload.description || requestPayload.memo || '';
                    const allowedMints = Array.isArray(requestPayload.mints) ? requestPayload.mints : [];
                    const transport = Array.isArray(requestPayload.transports) && requestPayload.transports.length
                      ? requestPayload.transports[0]
                      : null;
                    const transportLabel = transport?.t === 'nostr'
                      ? t('wallet.nostrTransport')
                      : transport?.t === 'post'
                        ? t('wallet.httpTransport')
                        : transport?.t
                          ? transport.t.toUpperCase()
                          : t('wallet.unknownTransport');

                    return (
                      <div className="payment-request-details">
                        <div className="detail-row primary">
                          <span>{t('wallet.ecashRequestAmount')}</span>
                          <strong>{formatAmount(requestAmount)} sats</strong>
                        </div>
                        {requestFiatDisplay && (
                          <div className="detail-row">
                            <span>{t('wallet.fiatApproxLabel')}</span>
                            <strong>{t('wallet.fiatApprox', { value: requestFiatDisplay, source: rateSourceLabel })}</strong>
                          </div>
                        )}
                        <div className="detail-row">
                          <span>{t('wallet.afterBalance')}</span>
                          <strong>{formatAmount(ecashBalance - requestAmount)} sats</strong>
                        </div>
                        {requestMemo && (
                          <div className="detail-row narrow">
                            <span>{t('wallet.paymentRequestMemoLabel')}</span>
                            <span className="muted">{requestMemo}</span>
                          </div>
                        )}
                        {(requestPayload.id || allowedMints.length > 0 || transport) && (
                          <div style={{ marginTop: '0.5rem' }}>
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => setShowRequestDetails(!showRequestDetails)}
                              style={{ fontSize: '0.9rem', padding: '0.25rem 0' }}
                            >
                              {showRequestDetails ? `△ ${t('common.showLess')}` : `▽ ${t('common.showMore')}`}
                            </button>
                          </div>
                        )}
                        {showRequestDetails && (
                          <>
                            {requestPayload.id && (
                              <div className="detail-row narrow">
                                <span>{t('wallet.paymentRequestId')}</span>
                                <span className="muted">{requestPayload.id}</span>
                              </div>
                            )}
                            {allowedMints.length > 0 && (
                              <div className="detail-row narrow">
                                <span>{t('wallet.allowedMints')}</span>
                                <span className="muted">{allowedMints.map(formatMintLabel).join(', ')}</span>
                              </div>
                            )}
                            {transport && (
                              <div className="detail-row narrow">
                                <span>{t('wallet.transport')}</span>
                                <span className="muted">
                                  {transportLabel}
                                  {transport?.a && (
                                    <>
                                      {' · '}
                                      <span style={{ wordBreak: 'break-all' }}>{transport.a}</span>
                                    </>
                                  )}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                  {invoiceQuote && !isEcashRequest(sendAddress) && (
                    <div style={{ marginTop: '1rem', padding: '0.75rem', fontSize: '0.9rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                      <div>{t('wallet.sendAmount')}: <strong style={{ color: 'var(--text-primary)' }}>{formatAmount(invoiceQuote.invoiceAmount)} sats</strong></div>
                      <div>{t('wallet.fee')}: <strong style={{ color: 'var(--text-primary)' }}>{formatAmount(invoiceQuote.feeReserve)} sats</strong></div>
                      <div>{t('wallet.afterBalance')}: <strong style={{ color: 'var(--text-primary)' }}>{formatAmount(invoiceQuote.available - invoiceQuote.need)} sats</strong></div>
                    </div>
                  )}
                  {invoiceError && (
                    <div className="warning-banner danger" style={{ marginTop: '1rem' }}>
                      {invoiceError}
                    </div>
                  )}
                  <div className="send-actions">
                    <button
                      onClick={prepareSend}
                      className="primary-btn"
                      disabled={
                        loading ||
                        fetchingQuote ||
                        !isConnected ||
                        !!invoiceError ||
                        (isBolt11Invoice(sendAddress) && !invoiceQuote) ||
                        (isEcashRequest(sendAddress) && !parseEcashRequest(sendAddress)) ||
                        (!isBolt11Invoice(sendAddress) && !isEcashRequest(sendAddress) && !(isLightningAddress(sendAddress) && Number(sendAmount) > 0)) ||
                        (invoiceQuote && invoiceQuote.available < invoiceQuote.need)
                      }
                    >
                      {loading ? t('wallet.sending') : fetchingQuote ? t('common.checkingInvoice') : t('wallet.send')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {!isConnected && (
                    <div className="network-warning" style={{ marginBottom: '1rem' }}>
                      {networkDisconnectedMessage}
                    </div>
                  )}
                  <div className="ecash-keypad-card">
                    <div className="ecash-keypad-display">
                      <span className="label">{t('wallet.amount')}</span>
                      <div className="value">
                        {formatAmount(ecashSendToken ? ecashSendTokenAmount : ecashSendAmountValue || 0)} <span className="unit">sats</span>
                      </div>
                      {!ecashSendToken && ecashSendFiatDisplay && (
                        <div className="fiat">
                          {t('wallet.fiatApprox', { value: ecashSendFiatDisplay, source: rateSourceLabel })}
                        </div>
                      )}
                      {ecashSendToken && ecashTokenFiatDisplay && (
                        <div className="fiat">
                          {t('wallet.fiatApprox', { value: ecashTokenFiatDisplay, source: rateSourceLabel })}
                        </div>
                      )}
                      <div className="available">
                        {t('wallet.availableBalance', { amount: formatAmount(ecashBalance) })}
                      </div>
                    </div>
                    {!ecashSendToken && (
                      <>
                        <div className="ecash-keypad-grid">
                          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'].map((val) => (
                            <button
                              key={val}
                              type="button"
                              className="ecash-keypad-button"
                              onClick={() => handleEcashKeypadPress(val)}
                              aria-label={val === 'del' ? t('wallet.keypadDelete') : undefined}
                              disabled={loading || !isConnected}
                            >
                              {val === 'del' ? '⌫' : val}
                            </button>
                          ))}
                        </div>
                        <div className="send-actions keypad-actions">
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleEcashKeypadPress('clear')}
                            disabled={loading}
                          >
                            {t('wallet.clearAmount')}
                          </button>
                          <button
                            type="button"
                            className="primary-btn"
                            onClick={handleGenerateEcashToken}
                            disabled={loading || !ecashSendAmountValue || ecashSendAmountValue > ecashBalance || !isConnected}
                          >
                            {loading ? t('wallet.generatingRequest') : t('wallet.confirmAmount')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {ecashSendError && (
                    <div className="warning-banner danger" style={{ marginBottom: '1rem' }}>
                      {ecashSendError}
                    </div>
                  )}
                  {ecashSendToken && (
                    <>
                      <div className="invoice-section receive-invoice">
                        <div className="qr-placeholder">
                          <div
                            className="qr-image-container"
                            onClick={() => {
                              if (!ecashSendToken) return;
                              setQrModalPayload({
                                type: 'token',
                                data: ecashSendToken,
                                amount: ecashSendTokenAmount,
                                mint: ecashSendTokenMint || mintUrl
                              });
                              setShowQrModal(true);
                            }}
                          >
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=H&data=${encodeURIComponent(ecashSendToken)}`}
                              alt="Cashu Token QR"
                              className="qr-image"
                            />
                            <div className="qr-logo-overlay">
                              <img src="/logo-192.png" alt="Logo" className="qr-logo" />
                            </div>
                          </div>
                          <div className="qr-zoom-hint">{t('wallet.tapToZoom')}</div>
                        </div>
                        <label className="invoice-copy-label">{t('wallet.ecashTokenCopyHint')}</label>
                        <div className="invoice-input-wrapper">
                          <textarea
                            value={ecashSendToken}
                            readOnly
                            className="invoice-textarea clickable"
                            onFocus={(e) => e.target.select()}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(ecashSendToken);
                                setEcashTokenCopied(true);
                                setTimeout(() => setEcashTokenCopied(false), 2000);
                              } catch {
                                addToast(t('messages.copyFailed'), 'error');
                              }
                            }}
                            rows="5"
                          />
                          {ecashTokenCopied && (
                            <div className="copy-success-message">{t('wallet.copied')}</div>
                          )}
                        </div>
                      </div>
                      <div className="send-actions">
                        <div className="qr-detail-card qr-detail-textarea">
                          <div className="qr-detail-row">
                            <span className="label">{t('wallet.amount')}</span>
                            <span className="value">
                              {formatAmount(ecashSendTokenAmount)} sats
                              {ecashTokenFiatDisplay && (
                                <>
                                  {' · '}
                                  {ecashTokenFiatDisplay}
                                  {rateSourceLabel ? ` (${rateSourceLabel})` : ''}
                                </>
                              )}
                            </span>
                          </div>
                          <div className="qr-detail-line">
                            <span className="label">{t('wallet.mintLabel')}</span>
                            <span className="value">{formatMintLabel(ecashSendTokenMint || mintUrl)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={handleResetEcashToken}
                        >
                          {t('wallet.createAnotherToken')}
                        </button>
                      </div>
                      <div className="ecash-token-note info">
                        <Icon name="info" size={16} />
                        <span>{t('wallet.ecashTokenInstructions')}</span>
                      </div>
                      <div className="ecash-token-note info">
                        <Icon name="info" size={16} />
                        <span>{t('wallet.ecashTokenShareHint')}</span>
                      </div>
                      <div className="ecash-token-note warning">
                        <Icon name="alert-circle" size={16} />
                        <span>{t('wallet.ecashTokenWarning')}</span>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : isReceiveView ? (
        <div className="receive-page">
          <div className="receive-card">
            <div className="receive-card-header">
              <h2><Icon name="inbox" size={20} /> {t('wallet.receiveTitle')}</h2>
              <p className="receive-subtext">{t('wallet.receiveSubtext')}</p>
            </div>

            <div className="receive-tabs">
              <button
                className={`receive-tab ${receiveTab === 'lightning' ? 'active' : ''}`}
                onClick={() => setReceiveTab('lightning')}
              >
                <Icon name="bolt" size={14} /> {t('wallet.lightningTab')}
              </button>
              <button
                className={`receive-tab ${receiveTab === 'ecash' ? 'active' : ''}`}
                onClick={() => setReceiveTab('ecash')}
              >
                <Icon name="coins" size={14} /> {t('wallet.ecashTab')}
              </button>
              <button
                className={`receive-tab ${receiveTab === 'token' ? 'active' : ''}`}
                onClick={() => setReceiveTab('token')}
              >
                <Icon name="inbox" size={14} /> {t('wallet.tokenTab')}
              </button>
            </div>

            <div className="receive-info" style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--card-bg)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icon name="info" size={16} />
              {receiveTab === 'token' ? t('wallet.receiveViaToken') : receiveTab === 'ecash' ? t('wallet.receiveViaEcash') : t('wallet.receiveViaLightning')}
            </div>

            <div className="receive-card-body">
              {receiveCompleted ? (
                <>
                  <div className="payment-success receive-success">
                    <div className="success-checkmark">
                      <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                        <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
                        <path className="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                      </svg>
                    </div>
                    <h2 className="success-title">
                      {lastReceiveMode === 'token' ? t('wallet.tokenReceivedTitle') : lastReceiveMode === 'ecash' ? t('wallet.paymentRequestPaidTitle') : t('wallet.receiveComplete')}
                    </h2>
                    <p className="success-amount">
                      <span className="amount-value">{formatAmount(receivedAmount)}</span> sats
                    </p>
                    {receivedFiatDisplay && (
                      <p className="success-amount fiat">
                        {t('wallet.fiatApprox', { value: receivedFiatDisplay, source: rateSourceLabel })}
                      </p>
                    )}
                    <p className="success-message">
                      {lastReceiveMode === 'token' ? t('wallet.tokenReceivedDescription') : lastReceiveMode === 'ecash' ? t('wallet.paymentRequestPaidDescription') : t('wallet.receiveSuccess')}
                    </p>
                  </div>
                  <div className="receive-actions">
                    <button className="primary-btn" onClick={exitReceiveFlow}>{t('common.confirm')}</button>
                  </div>
                </>
              ) : receiveTab === 'lightning' ? (
                <>
                  <div className="warning-banner warning">
                    <div className="warning-content">
                      {t('wallet.receiveMinBeta', { amount: RECEIVE_MAX_AMOUNT })}
                    </div>
                  </div>
                  {!invoice ? (
                    <>
                      {!isConnected ? (
                        <div className="network-warning" style={{ marginBottom: '1rem' }}>
                          {networkDisconnectedMessage}
                        </div>
                      ) : null}
                      <div className="input-group">
                        <label>{t('wallet.amountToReceive')}</label>
                        <input
                          type="number"
                          value={receiveAmount}
                          onChange={(e) => handleReceiveAmountChange(e.target.value)}
                          placeholder="10000"
                          min={RECEIVE_MIN_AMOUNT}
                          max={RECEIVE_MAX_AMOUNT}
                          disabled={!isConnected}
                        />
                      </div>
                      {receiveAmountTooLow && (
                        <div className="receive-error">
                          {t('wallet.receiveAmountMinimum', { amount: RECEIVE_MIN_AMOUNT })}
                        </div>
                      )}
                      {receiveAmountTooHigh && (
                        <div className="receive-error">
                          {t('wallet.receiveAmountMaximum', { amount: RECEIVE_MAX_AMOUNT })}
                        </div>
                      )}
                      {invoiceError && (
                        <div className="receive-error" style={{
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '0.75rem',
                          borderRadius: '0.5rem',
                          marginTop: '0.5rem'
                        }}>
                          {invoiceError}
                        </div>
                      )}
                      {!receiveAmountTooLow && !receiveAmountTooHigh && receiveFiatDisplay && (
                        <div className="fiat-hint">
                          {t('wallet.fiatApprox', { value: receiveFiatDisplay, source: rateSourceLabel })}
                        </div>
                      )}
                      <div className="receive-actions">
                        <button
                          onClick={generateInvoice}
                          className="primary-btn"
                          disabled={loading || !receiveAmount || receiveAmountTooLow || receiveAmountTooHigh || !isConnected}
                        >
                          {loading ? t('wallet.generatingInvoice') : t('wallet.generateInvoice')}
                        </button>
                      </div>
                    </>
                  ) : (loading || (invoice && !qrLoaded)) ? (
                    <div className="invoice-loading">
                      <div className="loading-spinner"></div>
                      <p>{t('wallet.generatingInvoice')}</p>
                      {invoice && (
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=H&data=${encodeURIComponent((invoice || '').toLowerCase().startsWith('ln') ? 'lightning:' + invoice : invoice)}`}
                          alt="Loading QR"
                          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                          onLoad={() => setQrLoaded(true)}
                          onError={() => setQrLoaded(true)}
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="invoice-section receive-invoice">
                        <div className="qr-placeholder">
                          <div className="qr-image-container" onClick={() => openQrModal('lightning', pendingRequestAmount)}>
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=H&data=${encodeURIComponent(
                                ((invoice || '').toLowerCase().startsWith('ln') ? 'lightning:' + invoice : invoice)
                              )}`}
                              alt="Lightning Invoice QR"
                              className="qr-image"
                            />
                            <div className="qr-logo-overlay">
                              <img src="/logo-192.png" alt="Logo" className="qr-logo" />
                            </div>
                          </div>
                          <div className="qr-zoom-hint">{t('wallet.tapToZoom')}</div>
                        </div>
                        <label className="invoice-copy-label">{t('wallet.tapToCopy')}</label>
                        <div className="invoice-input-wrapper">
                          <textarea
                            value={invoice}
                            readOnly
                            className="invoice-textarea clickable"
                            onFocus={(e) => e.target.select()}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(invoice);
                                setInvoiceCopied(true);
                                setTimeout(() => setInvoiceCopied(false), 2000);
                              } catch {
                                addToast(t('messages.copyFailed'), 'error');
                              }
                            }}
                            rows="5"
                          />
                          {invoiceCopied && (
                            <div className="copy-success-message">{t('wallet.copied')}</div>
                          )}
                        </div>
                      </div>
                      <div className="receive-actions">
                        <div className="qr-detail-card qr-detail-textarea">
                          <div className="qr-detail-row">
                            <span className="label">{t('wallet.amount')}</span>
                            <span className="value">
                              {formatAmount(pendingRequestAmount)} sats
                              {paymentRequestFiatDisplay && (
                                <>
                                  {' · '}
                                  {paymentRequestFiatDisplay}
                                  {rateSourceLabel ? ` (${rateSourceLabel})` : ''}
                                </>
                              )}
                            </span>
                          </div>
                          <div className="qr-detail-line">
                            <span className="label">Mint</span>
                            <span className="value">{mintUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={() => {
                            try { stopAutoRedeem(); } catch {}
                            setInvoice('');
                            setEcashRequest('');
                            setEcashRequestId(null);
                            setCheckingPayment(false);
                            setReceiveCompleted(false);
                            setReceivedAmount(0);
                            setQrLoaded(false);
                          }}
                        >
                          {t('wallet.recreate')}
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : receiveTab === 'ecash' ? (
                <>
                  <div className="warning-banner warning">
                    <div className="warning-content">
                      {t('wallet.receiveRequestHint')}
                    </div>
                  </div>
                      {!ecashRequest ? (
                        <>
                          {!isConnected && (
                            <div className="network-warning" style={{ marginBottom: '1rem' }}>
                              {networkDisconnectedMessage}
                            </div>
                          )}
                          <div className="input-group">
                            <label>{t('wallet.amountToReceive')}</label>
                            <input
                              type="number"
                              value={receiveAmount}
                          onChange={(e) => handleReceiveAmountChange(e.target.value)}
                          placeholder="10000"
                          min={RECEIVE_MIN_AMOUNT}
                          max={RECEIVE_MAX_AMOUNT}
                          disabled={!isConnected}
                        />
                      </div>
                      {receiveAmountTooLow && (
                        <div className="receive-error">
                          {t('wallet.receiveAmountMinimum', { amount: RECEIVE_MIN_AMOUNT })}
                        </div>
                      )}
                      {receiveAmountTooHigh && (
                        <div className="receive-error">
                          {t('wallet.receiveAmountMaximum', { amount: RECEIVE_MAX_AMOUNT })}
                        </div>
                      )}
                      {invoiceError && (
                        <div className="receive-error" style={{
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '0.75rem',
                          borderRadius: '0.5rem',
                          marginTop: '0.5rem'
                        }}>
                          {invoiceError}
                        </div>
                      )}
                      {!receiveAmountTooLow && !receiveAmountTooHigh && receiveFiatDisplay && (
                        <div className="fiat-hint">
                          {t('wallet.fiatApprox', { value: receiveFiatDisplay, source: rateSourceLabel })}
                        </div>
                      )}
                      <div className="receive-actions">
                        <button
                          onClick={generateEcashRequest}
                          className="primary-btn"
                          disabled={loading || !receiveAmount || receiveAmountTooLow || receiveAmountTooHigh || !isConnected}
                        >
                          {loading ? t('wallet.generatingRequest') : t('wallet.createPaymentRequest')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="invoice-section receive-invoice">
                        <div className="qr-placeholder">
                          <div className="qr-image-container" onClick={() => openQrModal('ecash', pendingRequestAmount)}>
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=H&data=${encodeURIComponent(ecashRequest)}`}
                              alt="NUT-18 Payment Request QR"
                              className="qr-image"
                            />
                            <div className="qr-logo-overlay">
                              <img src="/logo-192.png" alt="Logo" className="qr-logo" />
                            </div>
                          </div>
                          <div className="qr-zoom-hint">{t('wallet.tapToZoom')}</div>
                        </div>
                        <label className="invoice-copy-label">{t('wallet.tapToCopy')}</label>
                        <div className="invoice-input-wrapper">
                          <textarea
                            value={ecashRequest}
                            readOnly
                            className="invoice-textarea clickable"
                            onFocus={(e) => e.target.select()}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(ecashRequest);
                                setInvoiceCopied(true);
                                setTimeout(() => setInvoiceCopied(false), 2000);
                              } catch {
                                addToast(t('messages.copyFailed'), 'error');
                              }
                            }}
                            rows="5"
                          />
                          {invoiceCopied && (
                            <div className="copy-success-message">{t('wallet.copied')}</div>
                          )}
                        </div>
                      </div>
                      <div className="receive-actions">
                        <div className="qr-detail-card qr-detail-textarea">
                          <div className="qr-detail-row">
                            <span className="label">{t('wallet.amount')}</span>
                            <span className="value">
                              {formatAmount(receiveAmount)} sats
                              {receiveFiatDisplay && (
                                <>
                                  {' · '}
                                  {receiveFiatDisplay}
                                  {rateSourceLabel ? ` (${rateSourceLabel})` : ''}
                                </>
                              )}
                            </span>
                          </div>
                          <div className="qr-detail-line">
                            <span className="label">{t('wallet.transport')}</span>
                            <span className="value">{activeTransportSummary || t('wallet.unknownTransport')}</span>
                          </div>
                          {ecashRequestId && (
                            <div className="qr-detail-line">
                              <span className="label">{t('wallet.paymentRequestId')}</span>
                              <span className="value">{ecashRequestId}</span>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={exitReceiveFlow}
                        >
                          {t('wallet.cancelRequest')}
                        </button>
                        <button
                          type="button"
                          className="primary-btn"
                            onClick={() => {
                              setEcashRequest('');
                              setEcashRequestId(null);
                              setCheckingPayment(false);
                              localStorage.removeItem('cashu_last_ecash_request_id');
                              localStorage.removeItem('cashu_last_ecash_request_amount');
                              localStorage.removeItem('cashu_last_ecash_request_string');
                            }}
                        >
                          {t('wallet.recreate')}
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="warning-banner info">
                    <div className="warning-content">
                      {t('wallet.tokenReceiveHint')}
                    </div>
                  </div>

                  {enableTokenScanner ? (
                    <div className="qr-scanner-section">
                      <QrScanner onScan={handleTokenQrScan} onError={handleTokenQrError} />
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setEnableTokenScanner(false)}
                      >
                        {t('wallet.closeScanner')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="input-group">
                        <label>{t('wallet.pasteToken')}</label>
                        <textarea
                          value={ecashTokenInput}
                          onChange={(e) => setEcashTokenInput(e.target.value)}
                          placeholder="cashuA..."
                          rows="5"
                          style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                        />
                        <small>{t('wallet.tokenInputHint')}</small>
                      </div>

                      {invoiceError && (
                        <div className="receive-error" style={{
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '0.75rem',
                          borderRadius: '0.5rem',
                          marginTop: '0.5rem'
                        }}>
                          {invoiceError}
                        </div>
                      )}

                      <div className="receive-actions">
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => setEnableTokenScanner(true)}
                          disabled={loading}
                        >
                          <Icon name="qrcode" size={16} /> {t('wallet.scanQrCode')}
                        </button>
                        <button
                          onClick={handleReceiveToken}
                          className="primary-btn"
                          disabled={loading || !ecashTokenInput.trim()}
                        >
                          {loading ? t('wallet.receiving') : t('wallet.receiveToken')}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
      <div className="wallet-header">
        <img src="/logo-192.png" alt={t('common.logoAlt')} className="wallet-logo" />
        <p className="wallet-subtitle">{t('wallet.subtitle')}</p>
        {walletName && <h2 className="wallet-name-title">{t('wallet.walletTitle', { name: walletName })}</h2>}
      </div>

      <div className="warning-banner warning">
        <div className="warning-content">
          {t('wallet.receiveMinBeta', { amount: RECEIVE_MAX_AMOUNT })}
        </div>
      </div>

      {/* Storage warning banners */}
      {!storageHealthy && (
        <div className="warning-banner danger">
          <div>
            <strong>{t('wallet.storageAccessDenied')}</strong> · {t('wallet.storageAccessDeniedDesc')}
          </div>
        </div>
      )}
      {storageHealthy && showBackupBanner && (
        <div className="warning-banner warning">
          <div className="warning-content">
            <strong>{t('wallet.backupImportant')}</strong> · {t('wallet.backupWarningDesc')}
          </div>
          <button className="warning-close-btn" onClick={() => { try { localStorage.setItem('cashu_backup_dismissed', '1'); } catch {}; setShowBackupBanner(false); }}>
            <Icon name="close" size={18} />
          </button>
        </div>
      )}


      {/* Mint explainer moved to About page for clarity */}


      {/* Single Balance Card (eCash as primary) */}
      <div className="balance-cards">
        <div className="balance-card ecash-card">
          <div className="balance-header">
            <div className="balance-info">
              <h3>
                <Icon name="bitcoin" size={20} />
                {t('wallet.balance')}
              </h3>
              <div className="balance-amount">
                {formatAmount(ecashBalance)} <span className="unit">sats</span>
              </div>
              {fiatRate.loading && !balanceFiatDisplay && (
                <div className="fiat-approx muted">{t('wallet.fiatRateLoading')}</div>
              )}
              {fiatRate.error && !fiatRate.loading && (
                <div className="fiat-approx error">{t('wallet.fiatRateUnavailable')}</div>
              )}
              {balanceFiatDisplay && !fiatRate.error && (
                <div className="fiat-approx">
                  {t('wallet.fiatApprox', { value: balanceFiatDisplay, source: rateSourceLabel })}
                </div>
              )}
            </div>
            <div className="balance-manage">
              <button className="icon-btn" onClick={handleBackup} title={t('wallet.backup')}>
                <Icon name="download" size={18} />
              </button>
              <button className="icon-btn" onClick={() => fileInputRef.current?.click()} title={t('wallet.restore')}>
                <Icon name="upload" size={18} />
              </button>
              <input type="file" accept="application/json" ref={fileInputRef} style={{ display: 'none' }} onChange={handleRestoreFile} />
            </div>
          </div>
          {infoMessage && (
            <div className="info-message-container">
              <div className="network-warning" style={{
                backgroundColor: infoMessageType === 'success' ? 'rgba(16, 185, 129, 0.1)' : infoMessageType === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                borderColor: infoMessageType === 'success' ? 'rgba(16, 185, 129, 0.3)' : infoMessageType === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)',
                color: 'var(--text)',
                marginBottom: 0
              }}>
                {infoMessage}
              </div>
            </div>
          )}
          <div className="balance-actions">
            {!isConnected ? (
              <div className="network-warning">
                {networkDisconnectedMessage}
              </div>
            ) : (
              <>
                <button
                  onClick={handleReceiveNavigation}
                  className="action-btn receive-btn"
                >
                  <Icon name="inbox" size={16} /> {t('wallet.receive')}
                </button>
                <button
                  onClick={handleSendNavigation}
                  className="action-btn send-btn"
                  disabled={ecashBalance === 0}
                >
                  <Icon name="send" size={16} /> {t('wallet.send')}
                </button>
              </>
            )}
          </div>
          {isConnected && (
            <div className="mint-status-bottom">
              <span className={`status-dot ${isConnected ? 'on' : 'off'}`}></span>
              <small className="status-text">{t('wallet.mintStatus')}</small>
            </div>
          )}
        </div>
      </div>

      {/* Send Modal */}
      {showSend && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{t('wallet.lightningSend')}</h3>
              <button onClick={() => { setEnableSendScanner(false); setShowSend(false); setInvoiceQuote(null); setInvoiceError(''); }} aria-label={t('common.close')}><Icon name="close" size={20} /></button>
            </div>
            <div className="modal-body">
              {enableSendScanner && (
                <QrScanner onScan={handleSendQrScan} onError={handleSendQrError} />
              )}
              <div className="input-group">
                <label>{t('wallet.lightningAddress')}</label>
                <textarea
                  value={sendAddress}
                  onChange={(e) => setSendAddress(e.target.value)}
                  placeholder={t('wallet.invoicePlaceholder')}
                  rows="3"
                />
                <small>
                  {isBolt11Invoice(sendAddress)
                    ? t('wallet.invoiceDetected')
                    : isLightningAddress(sendAddress)
                      ? t('wallet.addressDetected')
                      : t('wallet.invoiceOrAddressHint')}
                </small>
                {!enableSendScanner && (
                  <div className="qr-rescan">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setEnableSendScanner(true)}
                    >
                      {t('wallet.rescanQr')}
                    </button>
                  </div>
                )}
              </div>
              {!isBolt11Invoice(sendAddress) && (
                <div className="input-group">
                  <label>{t('wallet.amountToSend')}</label>
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    placeholder={t('wallet.amountPlaceholder')}
                    min="1"
                    max={ecashBalance}
                  />
                  <small>{t('wallet.availableBalance', { amount: formatAmount(ecashBalance) })}</small>
                {sendFiatDisplay && (
                  <div className="fiat-hint">
                    {t('wallet.fiatApprox', { value: sendFiatDisplay, source: rateSourceLabel })}
                  </div>
                )}
                </div>
              )}
              {invoiceQuote && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', fontSize: '0.9rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                  <div>{t('wallet.sendAmount')}: <strong style={{ color: 'var(--text-primary)' }}>{formatAmount(invoiceQuote.invoiceAmount)} sats</strong></div>
                  <div>{t('wallet.fee')}: <strong style={{ color: 'var(--text-primary)' }}>{formatAmount(invoiceQuote.feeReserve)} sats</strong></div>
                  <div>{t('wallet.afterBalance')}: <strong style={{ color: 'var(--text-primary)' }}>{formatAmount(invoiceQuote.available - invoiceQuote.need)} sats</strong></div>
                </div>
              )}
              {invoiceError && (
                <div className="warning-banner danger" style={{ marginTop: '1rem' }}>
                  {invoiceError}
                </div>
              )}
              <div className="modal-actions">
                 <button
                  onClick={prepareSend}
                  className="primary-btn"
                  disabled={
                    loading ||
                    fetchingQuote ||
                    !!invoiceError ||
                    (isBolt11Invoice(sendAddress) && !invoiceQuote) ||
                    (!isBolt11Invoice(sendAddress) && !(isLightningAddress(sendAddress) && Number(sendAmount) > 0)) ||
                    (invoiceQuote && invoiceQuote.available < invoiceQuote.need)
                  }
                >
                  {loading ? t('wallet.sending') : fetchingQuote ? t('common.checkingInvoice') : t('wallet.send')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send Confirmation Modal */}
      {showSendConfirm && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{t('wallet.sendConfirmation')}</h3>
              <button onClick={() => { setShowSendConfirm(false); }} aria-label={t('common.close')}><Icon name="close" size={20} /></button>
            </div>
            <div className="modal-body">
              {pendingSendDetails ? (
                <>
                  <div className="conversion-info" style={{gridTemplateColumns:'1fr 1fr'}}>
                    <div className="info-item"><Icon name="bolt" size={16} /> {t('wallet.invoiceAmount')}: {formatAmount(pendingSendDetails.invoiceAmount)} sats</div>
                    <div className="info-item"><Icon name="info" size={16} /> {t('wallet.feeReserve')}: {formatAmount(pendingSendDetails.feeReserve)} sats</div>
                    <div className="info-item"><Icon name="diamond" size={16} /> {t('wallet.totalRequired')}: {formatAmount(pendingSendDetails.need)} sats</div>
                    <div className="info-item"><Icon name="shield" size={16} /> {t('wallet.available')}: {formatAmount(pendingSendDetails.available)} sats</div>
                  </div>
                  {pendingSendDetails.available < pendingSendDetails.need && (
                    <div className="warning-banner danger" style={{marginTop:'1rem'}}>
                      {t('wallet.insufficient')}: {formatAmount(pendingSendDetails.need - pendingSendDetails.available)} sats · {t('wallet.insufficientHint')}
                    </div>
                  )}
                  <div className="modal-actions" style={{marginTop:'1rem'}}>
                    <button className="primary-btn" onClick={confirmSend} disabled={loading || pendingSendDetails.available < pendingSendDetails.need}>
                      {loading ? t('wallet.sending') : t('common.confirm')}
                    </button>
                    <button className="secondary-btn" onClick={() => setShowSendConfirm(false)} disabled={loading}>{t('common.cancel')}</button>
                  </div>
                </>
              ) : (
                <div className="loading">{t('wallet.loadingQuote')}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Convert Modal */}
      {showConvert && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{t('wallet.lightningEcashConversion')}</h3>
              <button onClick={() => setShowConvert(false)} aria-label={t('common.close')}><Icon name="close" size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="conversion-direction">
                <div className="direction-buttons">
                  <button
                    className={`direction-btn ${convertDirection === 'ln_to_ecash' ? 'active' : ''}`}
                    aria-pressed={convertDirection === 'ln_to_ecash'}
                    onClick={() => setConvertDirection('ln_to_ecash')}
                  >
                    <Icon name="bolt" size={16} /> → <Icon name="shield" size={16} />
                    <span>Lightning → eCash</span>
                  </button>
                  <button
                    className={`direction-btn ${convertDirection === 'ecash_to_ln' ? 'active' : ''}`}
                    aria-pressed={convertDirection === 'ecash_to_ln'}
                    onClick={() => setConvertDirection('ecash_to_ln')}
                  >
                    <Icon name="shield" size={16} /> → <Icon name="bolt" size={16} />
                    <span>eCash → Lightning</span>
                  </button>
                </div>
              </div>
              <div className="input-group">
                <label>{t('wallet.amountToConvert')}</label>
                <input
                  type="number"
                  value={convertAmount}
                  onChange={(e) => setConvertAmount(e.target.value)}
                  placeholder="10000"
                  min="1"
                  max={ecashBalance}
                />
                <small>
                  {t('wallet.available')}: {formatAmount(ecashBalance)} sats
                  {convertAmount && (
                    <>
                      <br />
                      {t('wallet.fee')}: {Math.ceil(convertAmount * CONVERSION_FEE_RATE)} sats
                      <br />
                      {t('wallet.actualConversion')}: {Math.max(0, convertAmount - Math.ceil(convertAmount * CONVERSION_FEE_RATE))} sats
                    </>
                  )}
                </small>
              </div>
              <div className="conversion-info">
                <div className="info-item">
                  <Icon name="info" size={16} />
                  <span>{t('wallet.conversionFee')}: {(CONVERSION_FEE_RATE * 100).toFixed(1)}%</span>
                </div>
                <div className="info-item">
                  <Icon name="clock" size={16} />
                  <span>{t('wallet.estimatedTime')}: {t('wallet.estimatedTimeValue')}</span>
                </div>
              </div>
              <div className="modal-actions">
                <button
                  onClick={convertFunds}
                  className="primary-btn"
                  disabled={loading || !convertAmount}
                >
                  {loading ? t('wallet.converting') : t('wallet.convert')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Passphrase Modal */}
      {showPassphraseModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{passphraseAction === 'backup' ? t('wallet.encryptedBackup') : t('wallet.restoreEncryptedBackup')}</h3>
              <button onClick={() => { setShowPassphraseModal(false); setPassphrase(''); setPassphraseConfirm(''); }} aria-label={t('common.close')}>
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="modal-body">
              {passphraseAction === 'backup' ? (
                <>
                  <div className="input-group">
                    <label>{t('wallet.passphraseMinimum')}</label>
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder={t('wallet.passphraseInput')}
                      minLength="8"
                    />
                    <small>{t('wallet.passphraseHint')}</small>
                  </div>
                  <div className="input-group">
                    <label>{t('wallet.passphraseConfirm')}</label>
                    <input
                      type="password"
                      value={passphraseConfirm}
                      onChange={(e) => setPassphraseConfirm(e.target.value)}
                      placeholder={t('wallet.passphraseReenter')}
                      minLength="8"
                    />
                  </div>
                  <div className="modal-actions">
                    <button
                      className="primary-btn"
                      onClick={executeBackup}
                      disabled={loading || !passphrase || passphrase !== passphraseConfirm}
                    >
                      {loading ? t('wallet.encrypting') : t('wallet.downloadBackup')}
                    </button>
                    <button
                      className="secondary-btn"
                      onClick={() => { setShowPassphraseModal(false); setPassphrase(''); setPassphraseConfirm(''); }}
                      disabled={loading}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="input-group">
                    <label>{t('wallet.passphrase')}</label>
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder={t('wallet.enterBackupPassphrase')}
                    />
                    <small>{t('wallet.restorePassphraseHint')}</small>
                  </div>
                  <div className="modal-actions">
                    <button
                      className="primary-btn"
                      onClick={executeRestore}
                      disabled={loading || !passphrase}
                    >
                      {loading ? t('wallet.restoring') : t('wallet.restore')}
                    </button>
                    <button
                      className="secondary-btn"
                      onClick={() => { setShowPassphraseModal(false); setPassphrase(''); window._pendingRestoreData = null; }}
                      disabled={loading}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Transaction Detail Modal */}
      {showTxDetail && selectedTx && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{t('wallet.viewDetails')}</h3>
              <button onClick={() => { setShowTxDetail(false); setSelectedTx(null); }} aria-label={t('common.close')}>
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="tx-detail-section">
                <div className="tx-detail-header">
                  <div className="tx-detail-icon">
                    <Icon
                      name={
                        selectedTx.type === 'receive' ? 'inbox' :
                        selectedTx.type === 'send' ? 'send' :
                        'repeat'
                      }
                      size={32}
                    />
                  </div>
                  <h2 className={`tx-detail-amount ${selectedTx.amount > 0 ? 'positive' : 'negative'}`}>
                    {selectedTx.amount > 0 ? '+' : ''}{formatAmount(Math.abs(selectedTx.amount))} sats
                  </h2>
                  <p className="tx-detail-type">
                    {selectedTx.type === 'receive' ? t('wallet.receive') :
                     selectedTx.type === 'send' ? t('wallet.send') :
                     selectedTx.description}
                  </p>
                </div>
                <div className="tx-detail-info">
                  <div className="tx-detail-item">
                    <Icon name="clock" size={18} />
                    <div>
                      <strong>{t('transaction.datetime')}</strong>
                      <p>{formatDate(selectedTx.timestamp)}</p>
                    </div>
                  </div>
                  <div className="tx-detail-item">
                    <Icon name={selectedTx.type === 'receive' ? 'inbox' : selectedTx.type === 'send' ? 'send' : 'repeat'} size={18} />
                    <div>
                      <strong>{t('transaction.type')}</strong>
                      <p>{selectedTx.type === 'receive' ? t('transaction.typeReceive') : selectedTx.type === 'send' ? t('transaction.typeSend') : t('transaction.typeConvert')}</p>
                    </div>
                  </div>
                  <div className="tx-detail-item">
                    <Icon name="info" size={18} />
                    <div>
                      <strong>{t('transaction.status')}</strong>
                      <p className="tx-status-badge">{selectedTx.status === 'confirmed' ? t('messages.statusConfirmed') : t('messages.statusPending')}</p>
                    </div>
                  </div>
                  {(selectedTx.type === 'receive' || selectedTx.type === 'send') && (selectedTx?.mintUrl || '').trim() && (
                    <div className="tx-detail-item">
                      <Icon name="globe" size={18} />
                      <div>
                        <strong>{t('wallet.mintLabel')}</strong>
                        <p>{formatMintLabel(selectedTx.mintUrl)}</p>
                      </div>
                    </div>
                  )}
                  {selectedTx.actualAmount && (
                    <>
                      <div className="tx-detail-item">
                        <Icon name="diamond" size={18} />
                        <div>
                          <strong>{t('wallet.actualConversionAmount')}</strong>
                          <p>{formatAmount(selectedTx.actualAmount)} sats</p>
                        </div>
                      </div>
                      <div className="tx-detail-item">
                        <Icon name="bolt" size={18} />
                        <div>
                          <strong>{t('wallet.fee')}</strong>
                          <p>{formatAmount(selectedTx.fee)} sats</p>
                        </div>
                      </div>
                    </>
                  )}
                  <div className="tx-detail-item">
                    <Icon name="shield" size={18} />
                    <div>
                      <strong>{t('transaction.id')}</strong>
                      <p style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>{selectedTx.id}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="primary-btn" onClick={() => { setShowTxDetail(false); setSelectedTx(null); }}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div className="transactions">
        <h3>{t('wallet.transactions')}</h3>
        {loading ? (
          <div className="loading">{t('wallet.loadingTransactions')}</div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">{t('wallet.noTransactions')}</div>
        ) : (
          <>
            <div className="transaction-list">
              {transactions.slice(0, displayedTxCount).map(tx => (
                <div key={`${tx.id}-${txUpdateCounter}`} className="transaction-item">
                  <div className="tx-icon">
                    <Icon
                      name={
                        tx.type === 'receive' ? 'inbox' :
                        tx.type === 'send' ? 'send' :
                        'repeat'
                      }
                      size={18}
                    />
                  </div>
                  <div className="tx-details">
                    <div className="tx-description">
                      {tx.type === 'receive' ? t('wallet.receive') :
                       tx.type === 'send' ? t('wallet.send') :
                       tx.description}
                    </div>
                    {tx.memo && <div className="tx-memo">{tx.memo}</div>}
                    {(tx.type === 'receive' || tx.type === 'send') && (tx?.mintUrl || '').trim() && (
                      <div className="tx-mint" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                        {t('wallet.mintLabel')}: {formatMintLabel(tx.mintUrl)}
                      </div>
                    )}
                    <div className="tx-date">{formatDate(tx.timestamp)}</div>
                  </div>
                  <div className={`tx-amount ${tx.type === 'send' ? 'negative' : 'positive'}`}>
                    {tx.type === 'send' ? '-' : '+'}{formatAmount(Math.abs(tx.amount))} sats
                  </div>
                </div>
              ))}
            </div>
            {displayedTxCount < transactions.length && (
              <div
                className="load-more-link"
                onClick={() => setDisplayedTxCount(prev => prev + 10)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  justifyContent: 'center',
                  padding: '1rem',
                  cursor: 'pointer',
                  color: 'var(--primary)',
                  fontSize: '0.95rem'
                }}
              >
                <Icon name="plus" size={16} />
                <span>{t('wallet.loadMore', { count: transactions.length - displayedTxCount })}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* eCash Proofs Section */}
      <div className="proofs-section">
        <div className="proofs-header">
          <h3 onClick={() => setShowProofs(!showProofs)} style={{ cursor: 'pointer', flex: 1 }}>
            {t('wallet.ecashHoldings')} ({t('wallet.ecashCount', { count: totalEcashItems })})
          </h3>
          <div onClick={() => setShowProofs(!showProofs)} style={{ cursor: 'pointer' }}>
            <Icon name={showProofs ? 'chevron-up' : 'chevron-down'} size={20} />
          </div>
        </div>
        {showProofs && (
          <div className="proofs-list">
            {totalEcashItems === 0 ? (
              <div className="empty-state">{t('wallet.noEcash')}</div>
            ) : (
              <>
                {pendingEcashTransactions.map((tx) => {
                  const pendingMintUrl = tx?.mintUrl || mintUrl || 'Unknown Mint';
                  const displayMintUrl = pendingMintUrl.length > 40 ? pendingMintUrl.substring(0, 37) + '...' : pendingMintUrl;
                  return (
                    <div
                      key={`pending-${tx.id}`}
                      className="proof-item pending-proof"
                      style={{ opacity: 0.6 }}
                    >
                      <div className="proof-info">
                        <div className="proof-amount-status">
                          <span className="proof-amount">{formatAmount(tx?.amount || 0)} sats</span>
                          <div className="proof-status pending" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <Icon name="clock" size={14} />
                            {t('messages.statusPending')}
                          </div>
                        </div>
                      </div>
                      <div className="proof-mint" style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                        {t('wallet.mintLabel')}: <span className="monospace" title={pendingMintUrl}>{displayMintUrl}</span>
                      </div>
                      <div className="proof-pending-note">
                        <Icon name="lock" size={14} />
                        <span>{t('wallet.pendingEcashDisabled')}</span>
                      </div>
                      <div className="proof-pending-note">
                        <Icon name="clock" size={14} />
                        <span>{t('wallet.pendingSince', { date: formatDate(tx?.timestamp || Date.now()) })}</span>
                      </div>
                    </div>
                  );
                })}

                {proofs.map((proof, index) => {
                  const isValid = proof?.amount > 0 && proof?.secret && (proof?.id || proof?.C);
                  const isDisabled = proof?.disabled || false;
                  const disabledReason = proof?.disabledReason || '';
                  const disabledMessage = proof?.disabledMessage || '';
                  const mintUrl = proof?.mintUrl || 'Unknown Mint';
                  const displayMintUrl = mintUrl.length > 40 ? mintUrl.substring(0, 37) + '...' : mintUrl;
                  const canToggleProof = !isDisabled || disabledReason === 'user';
                  let toggleTitle = isDisabled ? t('wallet.enableProof') : t('wallet.disableProof');
                  if (isDisabled && disabledReason === 'swap_failed') {
                    toggleTitle = t('wallet.swapFailedProofLocked');
                  } else if (isDisabled && disabledReason && disabledReason !== 'user') {
                    toggleTitle = t('wallet.disabledReasonUnknown');
                  }

                  // Get disabled reason text
                  let disabledReasonText = '';
                  if (isDisabled) {
                    if (disabledReason === 'swap_failed') {
                      disabledReasonText = t('wallet.disabledReasonSwapFailed');
                    } else if (disabledReason === 'user') {
                      disabledReasonText = t('wallet.disabledReasonUser');
                    } else {
                      disabledReasonText = t('wallet.disabledReasonUnknown');
                    }
                  }

                  return (
                    <div
                      key={proof?.secret || index}
                      className="proof-item"
                      style={{ opacity: isDisabled ? 0.5 : 1 }}
                    >
                      <div className="proof-info">
                        <div className="proof-amount-status">
                          <span className="proof-amount">{formatAmount(proof?.amount || 0)} sats</span>
                          <div className={`proof-status ${isDisabled ? 'disabled' : (isValid ? 'valid' : 'invalid')}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {isDisabled ? t('wallet.disabled') : (isValid ? t('wallet.valid') : t('wallet.invalid'))}
                            {isDisabled && disabledReason === 'swap_failed' && (
                              <button
                                onClick={() => retrySwap(proof)}
                                className="icon-btn"
                                title={t('wallet.retrySwap')}
                                style={{ marginLeft: '0', padding: '0.25rem' }}
                                disabled={loading}
                              >
                                <Icon name="repeat" size={18} />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (!canToggleProof) return;
                                handleToggleProof(proof);
                              }}
                              className="icon-btn"
                              title={toggleTitle}
                              style={{ marginLeft: '0', padding: '0.25rem' }}
                              disabled={!canToggleProof}
                            >
                              <Icon name={isDisabled ? 'eye' : 'eye-off'} size={18} />
                            </button>
                          </div>
                        </div>
                      </div>
                      {isDisabled && disabledReasonText && (
                        <div className="proof-disabled-reason" style={{
                          fontSize: '0.85rem',
                          color: 'var(--error)',
                          marginTop: '0.5rem',
                          padding: '0.5rem',
                          backgroundColor: 'var(--error-bg)',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          <Icon name="alert-circle" size={14} />
                          <span>{disabledReasonText}</span>
                          {disabledMessage && <span style={{ marginLeft: '0.25rem', fontSize: '0.8rem', opacity: 0.8 }}>({disabledMessage})</span>}
                        </div>
                      )}
                      <div className="proof-mint" style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                        Mint: <span className="monospace" title={mintUrl}>{displayMintUrl}</span>
                      </div>
                      <div className="proof-secret">
                        Secret: <span className="monospace">{proof?.secret || ''}</span>
                      </div>
                      <div className="proof-id monospace">
                        ID: {proof?.id || proof?.C || ''}
                      </div>
                      {proof?.createdAt && (
                        <div className="proof-timestamp" style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
                          {t('wallet.createdAt')}: {new Date(proof.createdAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </>
      )}

      {/* QR Code Modal */}
      {showQrModal && qrModalPayload?.data && (
        <div className="qr-modal-overlay" onClick={closeQrModal}>
          <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={closeQrModal} aria-label="Close">
              <Icon name="close" size={24} />
            </button>
            <div className="qr-modal-body">
              <h3>{formatAmount(qrModalAmountValue)} sats</h3>
              <div className="qr-modal-code">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=H&data=${encodeURIComponent(qrModalDataValue)}`}
                  alt={qrModalAltText}
                />
                <div className="qr-logo-overlay">
                  <img src="/logo-192.png" alt="Logo" className="qr-logo" />
                </div>
              </div>
              <p className="qr-mint-info" style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                Mint: {qrModalMintLabel}
              </p>
              <p className="qr-modal-hint">{t('wallet.scanQrToPayHint')}</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default Wallet;
