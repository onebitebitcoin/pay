import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DEFAULT_MINT_URL, ECASH_CONFIG, apiUrl, API_BASE_URL } from '../config';
// Cashu mode: no join/federation or gateway UI
import { getBalanceSats, selectProofsForAmount, addProofs, removeProofs, loadProofs, exportProofsJson, importProofsFrom, syncProofsWithMint } from '../services/cashu';
import { createBlindedOutputs, signaturesToProofs, serializeOutputDatas, deserializeOutputDatas } from '../services/cashuProtocol';
import './Wallet.css';
import Icon from '../components/Icon';
import QrScanner from '../components/QrScanner';
const SATS_PER_BTC = 100000000;

const normalizeQrValue = (rawValue = '') => {
  if (!rawValue) return '';
  let cleaned = String(rawValue).trim();
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

const RECEIVE_MIN_AMOUNT = 1;
const RECEIVE_MAX_AMOUNT = 10;

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
  const [receivedAmount, setReceivedAmount] = useState(0);
  const [showEcashInfo, setShowEcashInfo] = useState(false);
  const [showPassphraseModal, setShowPassphraseModal] = useState(false);
  const [passphraseAction, setPassphraseAction] = useState('backup'); // 'backup' or 'restore'
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [showTxDetail, setShowTxDetail] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);
  const [invoiceCopied, setInvoiceCopied] = useState(false);
  const [qrLoaded, setQrLoaded] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');
  const [infoMessageType, setInfoMessageType] = useState('info'); // 'info', 'success', 'error'
  const [showProofs, setShowProofs] = useState(false);
  const [receiveAmountTooLow, setReceiveAmountTooLow] = useState(false);
  const [receiveAmountTooHigh, setReceiveAmountTooHigh] = useState(false);
  const [fiatRate, setFiatRate] = useState(() => createInitialFiatState(i18n.language));
  const [receiveTab, setReceiveTab] = useState('ecash'); // 'lightning' or 'ecash'
  const [ecashRequest, setEcashRequest] = useState(''); // eCash request string
  const [ecashRequestData, setEcashRequestData] = useState(null); // Stored output data for eCash request



  const PENDING_MINT_STORAGE_KEY = 'cashu_pending_mint_v1';
  const pendingMintRef = useRef(null);

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

  const rateSourceLabel = fiatRate.sourceKey ? t(`wallet.rateSource.${fiatRate.sourceKey}`) : '';
  const balanceFiatDisplay = formatFiatAmount(ecashBalance);
  const receiveFiatDisplay = formatFiatAmount(receiveAmount);
  const receivedFiatDisplay = formatFiatAmount(receivedAmount);
  const sendFiatDisplay = formatFiatAmount(sendAmount);

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

  const formatAmount = (sats) => {
    const localeMap = {
      ko: 'ko-KR',
      en: 'en-US',
      ja: 'ja-JP'
    };
    const locale = localeMap[i18n.language] || 'en-US';
    return new Intl.NumberFormat(locale).format(sats);
  };

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
  }, [showInfoMessage, mintUrl]);

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

  const hasQuoteRedeemed = useCallback((q) => {
    try {
      const raw = localStorage.getItem('cashu_redeemed_quotes') || '[]';
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.includes(q);
    } catch {
      return false;
    }
  }, []);

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
  }, [addToast, loadWalletData, mintUrl]);

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
  }, [clearPendingMint, ensurePendingMint]);

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
      // Close QR modal if open
      setShowQrModal(false);
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
  }, [addTransaction, addToast, applyRedeemedSignatures, isReceiveView, loadWalletData, markQuoteRedeemed, stopAutoRedeem, mintUrl]);

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
  }, [connectMint, ensurePendingMint, processPaymentNotification, stopAutoRedeem]);
  


  // Handle page visibility change (app resuming from background)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden || !isReceiveView || !checkingPayment) {
        return;
      }

      // App came back to foreground while waiting for payment
      console.log('App resumed, checking payment status...');

      try {
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
  }, [apiUrl, isReceiveView, checkingPayment, mintUrl, processPaymentNotification, startInvoicePolling]);

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

  // Stop polling when invoice is cleared or component unmounts
  useEffect(() => {
    // If invoice is cleared, stop any active polling
    if (!invoice && checkingPayment) {
      console.log('[Invoice cleared] Stopping polling');
      stopAutoRedeem();
    }

    // Handle page unload/navigation
    const handleBeforeUnload = () => {
      if (checkingPayment) {
        console.log('[Page unloading] Stopping polling');
        stopAutoRedeem();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup on unmount or navigation
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (checkingPayment) {
        console.log('[Component unmounting] Stopping polling');
        stopAutoRedeem();
      }
    };
  }, [invoice, checkingPayment, stopAutoRedeem]);

  // Manual sync proofs with Mint
  const handleSyncProofs = async () => {
    try {
      setLoading(true);
      showInfoMessage(t('messages.syncingTokens'), 'info', 2000);

      const syncResult = await syncProofsWithMint(API_BASE_URL, mintUrl);

      if (syncResult.removed > 0) {
        showInfoMessage(t('messages.removedUsedTokens', { count: syncResult.removed }), 'success', 4000);
        setEcashBalance(getBalanceSats());
      } else {
        showInfoMessage(t('messages.allTokensValid'), 'success', 3000);
      }
    } catch (error) {
      console.error('Sync error:', error);
      showInfoMessage(t('messages.syncFailed', { error: translateErrorMessage(error?.message) || t('messages.unknownError') }), 'error', 4000);
    } finally {
      setLoading(false);
    }
  };

  // Check and recover pending quote
  const checkPendingQuote = async () => {
    try {
      const lastQuote = localStorage.getItem('cashu_last_quote');
      if (!lastQuote) {
        showInfoMessage(t('messages.noPendingInvoice'), 'info');
        return;
      }

      // Check if already redeemed
      if (hasQuoteRedeemed(lastQuote)) {
        showInfoMessage(t('messages.alreadyProcessed'), 'info');
        return;
      }

      setLoading(true);
      showInfoMessage(t('messages.checkingInvoiceStatus'), 'info', 2000);
      
      // Temp debug: set status when checking pending quote


      // Check quote state
      const checkResp = await fetch(apiUrl(`/api/cashu/mint/quote/check?quote=${encodeURIComponent(lastQuote)}&mintUrl=${encodeURIComponent(mintUrl)}`));
      if (!checkResp.ok) throw new Error(t('messages.quoteCheckFailed'));

      const quoteData = await checkResp.json();
      const state = (quoteData?.state || '').toUpperCase();

      if (state !== 'PAID' && state !== 'ISSUED') {
        showInfoMessage(t('messages.invoiceNotPaid'), 'info');

        return;
      }

      // Quote is paid, try to redeem existing signatures first
      const cachedResultResp = await fetch(apiUrl(`/api/cashu/mint/result?quote=${encodeURIComponent(lastQuote)}`));
      if (cachedResultResp.ok) {
        const cachedJson = await cachedResultResp.json();
        if (Array.isArray(cachedJson?.signatures) && cachedJson.signatures.length) {
          const applied = await applyRedeemedSignatures(lastQuote, cachedJson.signatures, parseInt(quoteData?.amount || 0, 10));
          if (applied.ok && applied.added) {
            markQuoteRedeemed(lastQuote);
            setReceiveCompleted(true);
            setReceivedAmount(applied.added);
        addTransaction({
          id: Date.now(),
          type: 'receive',
          amount: applied.added,
          timestamp: new Date().toISOString(),
          status: 'confirmed',
          description: t('wallet.lightningReceive'),
          memo: '',
          mintUrl
        });

            showInfoMessage(t('messages.recoveredSuccess', { amount: formatAmount(applied.added) }), 'success');
            await loadWalletData();
            return;
          }
        }
      }

      // Fallback: request new outputs and redeem manually
      const amount = parseInt(quoteData?.amount || localStorage.getItem('cashu_last_mint_amount') || '0', 10);
      const keysResp = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl)}`));
      if (!keysResp.ok) throw new Error(t('messages.mintKeysFailed'));
      const mintKeys = await keysResp.json();
      const { outputs, outputDatas } = await createBlindedOutputs(amount, mintKeys);

      const redeemResp = await fetch(apiUrl('/api/cashu/mint/redeem'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote: lastQuote, outputs, mintUrl })
      });

      if (!redeemResp.ok) {
        const err = await redeemResp.json();
        const errorMsg = typeof err?.error === 'string' ? err.error : JSON.stringify(err?.error || err);

        // Check if already issued
        if (errorMsg.includes('already issued') || errorMsg.includes('11000')) {
          markQuoteRedeemed(lastQuote);
          throw new Error(t('messages.alreadyIssuedNoRecovery'));
        }

        throw new Error(errorMsg || t('messages.redeemFailed'));
      }

      const redeemData = await redeemResp.json();
      const signatures = redeemData?.signatures || redeemData?.promises || [];

      if (Array.isArray(signatures) && signatures.length > 0) {
        const proofs = await signaturesToProofs(signatures, mintKeys, outputDatas);
        addProofs(proofs, mintUrl);
        const added = proofs.reduce((s, p) => s + Number(p?.amount || 0), 0);
        setEcashBalance(getBalanceSats());
        clearPendingMint();
        markQuoteRedeemed(lastQuote);

        addTransaction({
          id: Date.now(),
          type: 'receive',
          amount: added,
          timestamp: new Date().toISOString(),
          status: 'confirmed',
          description: t('wallet.lightningReceive'),
          memo: '',
          mintUrl
        });
        


        showInfoMessage(t('messages.recoveredSuccess', { amount: formatAmount(added) }), 'success');
      } else {
        throw new Error(t('messages.noValidSignatures'));
      }
    } catch (error) {
      console.error('Failed to check quote:', error);
      showInfoMessage(translateErrorMessage(error?.message) || t('messages.quoteCheckError'), 'error');
    } finally {
      setLoading(false);
    }
  };

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
  }, [showInfoMessage]);

  const handleSendQrError = useCallback((err) => {
    console.error('QR scanner error:', err);
    const message = err && err.message ? translateErrorMessage(err.message) : t('messages.qrScanUnavailable');
    showInfoMessage(message, 'error', 3500);
  }, [showInfoMessage]);

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
        let msg = '인보이스 생성 실패';
        try {
          const err = await resp.json();
          // Check for mint backend error (code 20000)
          if (err?.code === 20000) {
            const displayMintUrl = mintUrl.replace('https://', '').replace('http://', '');
            msg = t('messages.mintBackendError', { mintUrl: displayMintUrl });
          } else {
            if (err?.error) msg = translateErrorMessage(err.error);
            else if (err?.detail) msg = err.detail;
            if (err?.code) msg += ` (코드: ${err.code})`;
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

    try {
      setLoading(true);
      setQrLoaded(false);
      setReceiveCompleted(false);
      setInvoiceError('');

      // Get mint keys and create blinded outputs for the request
      const keysResp = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl)}`));
      if (!keysResp.ok) throw new Error(t('messages.mintKeysFailed'));
      const mintKeys = await keysResp.json();
      const { outputs, outputDatas } = await createBlindedOutputs(amount, mintKeys);

      // Store output data for later when sender pays the request
      setEcashRequestData(outputDatas);

      // Create the eCash request string
      // Format: cashu:request:<mint_url>:<amount>:<blinded_outputs_json>
      const serializedOutputs = serializeOutputDatas(outputDatas);
      const requestPayload = {
        mint: mintUrl,
        amount,
        outputs: serializedOutputs
      };
      const requestString = `cashu:request:${btoa(JSON.stringify(requestPayload))}`;

      setEcashRequest(requestString);
      setQrLoaded(true);

      console.log('[DEBUG] eCash request generated:', {
        amount,
        mintUrl,
        outputsCount: outputs.length
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
    // Stop any active polling
    if (pollingCancelRef.current) {
      pollingCancelRef.current();
      pollingCancelRef.current = null;
    }

    try { stopAutoRedeem(); } catch {}
    setCheckingPayment(false);
    setInvoice('');
    setEcashRequest('');
    setEcashRequestData(null);
    setReceiveCompleted(false);
    setReceivedAmount(0);
    setReceiveAmount('');
    setReceiveAmountTooLow(false);
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
    setEcashRequestData(null);
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

  const exitSendFlow = useCallback(() => {
    setSendAmount('');
    setSendAddress('');
    setInvoiceQuote(null);
    setInvoiceError('');
    setEnableSendScanner(false);
    const target = sendOriginRef.current || '/wallet';
    navigate(target, { replace: true });
  }, [navigate]);

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
    const s = val.trim().toLowerCase();
    return s.startsWith('cashu:request:');
  };

  const parseEcashRequest = (val) => {
    try {
      if (!isEcashRequest(val)) return null;
      const base64Data = val.replace(/^cashu:request:/i, '');
      const jsonStr = atob(base64Data);
      const payload = JSON.parse(jsonStr);
      return payload; // { mint, amount, outputs: [serialized OutputData] }
    } catch (error) {
      console.error('Failed to parse eCash request:', error);
      return null;
    }
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

  const normalizeMintForCompare = useCallback((url) => {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  }, []);

  const isMeaninglessErrorCode = (value) => {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    return /^[0-9a-f]{8,}$/i.test(trimmed) || /^[0-9]{6,}$/.test(trimmed);
  };

  const translateErrorMessage = (errorMsg) => {
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
  };

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

  const buildLightningAddressErrorMessage = (err) => {
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
  };

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
          let msg = '유효하지 않은 인보이스입니다';
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

              msg = isMeaningless ? '유효하지 않은 인보이스입니다' : errorMsg;
            } else if (err?.detail) {
              // Some errors come with detail field directly
              let detailMsg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);

              // Check if detail is meaningless
              const isMeaningless = typeof detailMsg === 'string' && (
                /^[0-9a-f]{8,}$/i.test(detailMsg.trim()) ||
                detailMsg.trim().length < 3 ||
                /^[0-9]+$/.test(detailMsg.trim())
              );

              msg = isMeaningless ? '유효하지 않은 인보이스입니다' : detailMsg;
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
  }, [sendAddress]);

  // Send confirmation state
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const sendCtxRef = useRef(null); // { bolt11, quoteData }

  const handleEcashRequestSend = useCallback(async () => {
    try {
      setLoading(true);
      setInvoiceError('');

      // Parse the eCash request
      const requestPayload = parseEcashRequest(sendAddress);
      if (!requestPayload) {
        throw new Error(t('messages.invalidEcashRequest'));
      }

      const { mint, amount, outputs: serializedOutputs } = requestPayload;

      // Validate amount
      if (!amount || amount <= 0) {
        throw new Error(t('messages.invalidAmount'));
      }

      // Check balance
      const available = getBalanceSats();
      if (available < amount) {
        throw new Error(t('messages.insufficientBalanceDetails', { amount: formatAmount(amount - available) }));
      }

      // Select proofs for the amount
      const { ok, picked, total } = selectProofsForAmount(amount);
      if (!ok) throw new Error(t('messages.insufficientBalance'));

      const mintMismatchMessage = getMintMismatchMessage(picked);
      if (mintMismatchMessage) {
        setInvoiceError(mintMismatchMessage);
        showInfoMessage(mintMismatchMessage, 'error');
        throw new Error(mintMismatchMessage);
      }

      // Deserialize the receiver's blinded outputs
      const receiverOutputDatas = await deserializeOutputDatas(serializedOutputs);
      const receiverOutputs = receiverOutputDatas.map(od => od.blindedMessage);

      // Prepare for swap: inputs (our proofs) -> outputs (receiver's blinded messages)
      const uniquePicked = Array.from(new Map(picked.map(p => [p?.secret || JSON.stringify(p), p])).values());

      // Get mint keys for change calculation
      let changeOutputs = undefined;
      let changeOutputDatas = undefined;
      const change = Math.max(0, Number(total) - Number(amount));

      if (change > 0) {
        const kr = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mint)}`));
        if (!kr.ok) throw new Error(t('messages.mintKeysFetchError'));
        const mintKeys = await kr.json();
        const built = await createBlindedOutputs(change, mintKeys);
        changeOutputs = built.outputs;
        changeOutputDatas = built.outputDatas;
      }

      // Combine receiver outputs and change outputs
      const allOutputs = [...receiverOutputs, ...(changeOutputs || [])];

      // Perform swap
      const swapResp = await fetch(apiUrl('/api/cashu/swap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: uniquePicked,
          outputs: allOutputs,
          mintUrl: mint
        })
      });

      if (!swapResp.ok) {
        let msg = t('messages.ecashSendFailed');
        try {
          const err = await swapResp.json();
          if (err?.error) {
            msg = translateErrorMessage(err.error);
          }
        } catch {}
        throw new Error(msg);
      }

      const swapData = await swapResp.json();
      const signatures = swapData?.signatures || [];

      // First signatures go to receiver, remaining go to us as change
      const receiverSignatures = signatures.slice(0, receiverOutputs.length);
      const changeSignatures = signatures.slice(receiverOutputs.length);

      // Process our change
      let changeProofs = [];
      if (change > 0 && changeSignatures.length > 0 && changeOutputDatas) {
        const kr = await fetch(apiUrl(`/api/cashu/keys?mintUrl=${encodeURIComponent(mint)}`));
        if (kr.ok) {
          const mintKeys = await kr.json();
          changeProofs = await signaturesToProofs(changeSignatures, mintKeys, changeOutputDatas);
        }
      }

      // Remove spent proofs and add change
      removeProofs(uniquePicked);
      if (changeProofs.length > 0) {
        addProofs(changeProofs);
      }

      // Add transaction record
      addTransaction({
        id: Date.now(),
        type: 'send',
        amount: amount,
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        description: t('wallet.ecashSend'),
        memo: '',
        mintUrl: mint
      });

      // Update balance and navigate to success
      await loadWalletData();
      showInfoMessage(t('messages.ecashSendSuccess'), 'success');

      // Navigate to payment success page
      navigate('/wallet/payment-success', {
        state: {
          amount,
          type: 'ecash_send',
          from: '/wallet/send'
        },
        replace: true
      });

    } catch (error) {
      console.error('Failed to send eCash:', error);
      const errorMessage = error.message || t('messages.ecashSendFailed');
      setInvoiceError(errorMessage);
      showInfoMessage(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  }, [sendAddress, t, getBalanceSats, formatAmount, selectProofsForAmount, getMintMismatchMessage, showInfoMessage, apiUrl, deserializeOutputDatas, createBlindedOutputs, translateErrorMessage, signaturesToProofs, removeProofs, addProofs, addTransaction, loadWalletData, navigate]);

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

      const m = await fetch(apiUrl('/api/cashu/melt'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote: quoteData?.quote || quoteData?.quote_id,
          inputs: uniquePicked,
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
      const translatedMsg = translateErrorMessage(error?.message) || '송금에 실패했습니다';
      setInvoiceError(translatedMsg);
      showInfoMessage(translatedMsg, 'error');
    } finally {
      setLoading(false);
    }
  }, [sendAddress, invoiceQuote, enableSendScanner, setEnableSendScanner, setInvoiceError, addToast, t, apiUrl, getBalanceSats, selectProofsForAmount, addTransaction, removeProofs, addProofs, loadWalletData, setEcashBalance, setSendAmount, setSendAddress, setShowSend, setInvoiceQuote, navigate, translateErrorMessage, formatAmount, formatDate, mintUrl, getMintMismatchMessage, showInfoMessage]);

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
      const m = await fetch(apiUrl('/api/cashu/melt'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote: quoteData?.quote || quoteData?.quote_id, inputs: uniquePicked, outputs: changeOutputs, mintUrl })
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
  }, [sendCtxRef, t, selectProofsForAmount, apiUrl, createBlindedOutputs, addTransaction, removeProofs, addProofs, loadWalletData, setEcashBalance, setSendAmount, setSendAddress, setShowSend, setEnableSendScanner, setShowSendConfirm, setPendingSendDetails, navigate, pendingSendDetails, translateErrorMessage, formatAmount, formatDate, mintUrl, getMintMismatchMessage]);

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

    if (amount > ECASH_CONFIG.maxAmount) {
      showInfoMessage(t('messages.maxConversionAmount', { amount: formatAmount(ECASH_CONFIG.maxAmount) }), 'error');
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
  }, [convertAmount, convertDirection, ecashBalance, ECASH_CONFIG, showInfoMessage, t, formatAmount, setLoading]);

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
                const requestAmount = requestPayload.amount || 0;
                const requestFiatDisplay = fiatRate.rate ? formatFiatAmount(requestAmount) : null;
                return (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', fontSize: '0.9rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    <div>{t('wallet.ecashRequestAmount')}: <strong style={{ color: 'var(--text-primary)' }}>{formatAmount(requestAmount)} sats</strong></div>
                    {requestFiatDisplay && (
                      <div className="fiat-hint" style={{ marginTop: '0.5rem' }}>
                        {t('wallet.fiatApprox', { value: requestFiatDisplay, source: rateSourceLabel })}
                      </div>
                    )}
                    <div>{t('wallet.afterBalance')}: <strong style={{ color: 'var(--text-primary)' }}>{formatAmount(ecashBalance - requestAmount)} sats</strong></div>
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

            {/* Tabs for Lightning / eCash */}
            <div className="receive-tabs">
              <button
                className={`receive-tab ${receiveTab === 'ecash' ? 'active' : ''}`}
                onClick={() => {
                  setReceiveTab('ecash');
                  setInvoice('');
                  setEcashRequest('');
                  setEcashRequestData(null);
                  setInvoiceError('');
                  setQrLoaded(false);
                  if (pollingCancelRef.current) {
                    pollingCancelRef.current();
                    pollingCancelRef.current = null;
                  }
                  setCheckingPayment(false);
                }}
              >
                <Icon name="coins" size={16} /> eCash (cashu)
              </button>
              <button
                className={`receive-tab ${receiveTab === 'lightning' ? 'active' : ''}`}
                onClick={() => {
                  setReceiveTab('lightning');
                  setInvoice('');
                  setEcashRequest('');
                  setEcashRequestData(null);
                  setInvoiceError('');
                  setQrLoaded(false);
                }}
              >
                <Icon name="bitcoin" size={16} /> Lightning (walletofsatoshi)
              </button>
            </div>

            <div className="receive-card-body">


              {!receiveCompleted ? (
                <>
                  <div className="warning-banner warning">
                    <div className="warning-content">
                      {t('wallet.receiveMinBeta', { amount: RECEIVE_MIN_AMOUNT })}
                    </div>
                  </div>
                  {(receiveTab === 'lightning' && !invoice) || (receiveTab === 'ecash' && !ecashRequest) ? (
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
                          onClick={receiveTab === 'lightning' ? generateInvoice : generateEcashRequest}
                          className="primary-btn"
                          disabled={loading || !receiveAmount || receiveAmountTooLow || receiveAmountTooHigh || !isConnected}
                        >
                          {loading ? (receiveTab === 'lightning' ? t('wallet.generatingInvoice') : t('wallet.generatingRequest')) : (receiveTab === 'lightning' ? t('wallet.generateInvoice') : t('wallet.generateRequest'))}
                        </button>
                      </div>
                    </>
                  ) : (loading || ((invoice || ecashRequest) && !qrLoaded)) ? (
                    <div className="invoice-loading">
                      <div className="loading-spinner"></div>
                      <p>{receiveTab === 'lightning' ? t('wallet.generatingInvoice') : t('wallet.generatingRequest')}</p>
                      {invoice && (
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=H&data=${encodeURIComponent((invoice || '').toLowerCase().startsWith('ln') ? 'lightning:' + invoice : invoice)}`}
                          alt="Loading QR"
                          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                          onLoad={() => setQrLoaded(true)}
                          onError={() => setQrLoaded(true)}
                        />
                      )}
                      {ecashRequest && (
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=H&data=${encodeURIComponent(ecashRequest)}`}
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
                          <div className="qr-image-container" onClick={() => setShowQrModal(true)}>
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=H&data=${encodeURIComponent(
                                receiveTab === 'lightning'
                                  ? ((invoice || '').toLowerCase().startsWith('ln') ? 'lightning:' + invoice : invoice)
                                  : ecashRequest
                              )}`}
                              alt={receiveTab === 'lightning' ? "Lightning Invoice QR" : "eCash Request QR"}
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
                            value={receiveTab === 'lightning' ? invoice : ecashRequest}
                            readOnly
                            className="invoice-textarea clickable"
                            onFocus={(e) => e.target.select()}
                            onClick={async () => {
                              try {
                                const textToCopy = receiveTab === 'lightning' ? invoice : ecashRequest;
                                await navigator.clipboard.writeText(textToCopy);
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
                            setEcashRequestData(null);
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
              ) : (
                <>
                  <div className="payment-success receive-success">
                    <div className="success-checkmark">
                      <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                        <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
                        <path className="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                      </svg>
                    </div>
                    <h2 className="success-title">{t('wallet.receiveComplete')}</h2>
                    <p className="success-amount">
                      <span className="amount-value">{formatAmount(receivedAmount)}</span> sats
                    </p>
                    {receivedFiatDisplay && (
                      <p className="success-amount fiat">
                        {t('wallet.fiatApprox', { value: receivedFiatDisplay, source: rateSourceLabel })}
                      </p>
                    )}
                    <p className="success-message">{t('wallet.receiveSuccess')}</p>
                  </div>
                  <div className="receive-actions">
                    <button className="primary-btn" onClick={exitReceiveFlow}>{t('common.confirm')}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
      <div className="wallet-header">
        <img src="/logo-192.png" alt="한입 로고" className="wallet-logo" />
        <p className="wallet-subtitle">{t('wallet.subtitle')}</p>
        {walletName && <h2 className="wallet-name-title">{t('wallet.walletTitle', { name: walletName })}</h2>}
      </div>

      <div className="warning-banner warning">
        <div className="warning-content">
          {t('wallet.receiveMinBeta', { amount: RECEIVE_MIN_AMOUNT })}
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
              <button className="icon-btn" onClick={checkPendingQuote} title={t('wallet.checkPending')} disabled={loading}>
                <Icon name="repeat" size={18} />
              </button>
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
                    ? '✓ 인보이스가 감지되었습니다'
                    : isLightningAddress(sendAddress)
                      ? '✓ 라이트닝 주소가 감지되었습니다'
                      : '라이트닝 인보이스(lnbc...) 또는 주소(user@domain)를 입력하세요'}
                </small>
                {!enableSendScanner && (
                  <div className="qr-rescan">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setEnableSendScanner(true)}
                    >
                      QR 다시 스캔하기
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
              <h3>송금 확인</h3>
              <button onClick={() => { setShowSendConfirm(false); }} aria-label="닫기"><Icon name="close" size={20} /></button>
            </div>
            <div className="modal-body">
              {pendingSendDetails ? (
                <>
                  <div className="conversion-info" style={{gridTemplateColumns:'1fr 1fr'}}>
                    <div className="info-item"><Icon name="bolt" size={16} /> {t('wallet.invoiceAmount')}: {formatAmount(pendingSendDetails.invoiceAmount)} sats</div>
                    <div className="info-item"><Icon name="info" size={16} /> {t('wallet.feeReserve')}: {formatAmount(pendingSendDetails.feeReserve)} sats</div>
                    <div className="info-item"><Icon name="diamond" size={16} /> 총 필요: {formatAmount(pendingSendDetails.need)} sats</div>
                    <div className="info-item"><Icon name="shield" size={16} /> 보유 eCash: {formatAmount(pendingSendDetails.available)} sats</div>
                  </div>
                  {pendingSendDetails.available < pendingSendDetails.need && (
                    <div className="warning-banner danger" style={{marginTop:'1rem'}}>
                      부족: {formatAmount(pendingSendDetails.need - pendingSendDetails.available)} sats · 먼저 eCash를 더 받으세요.
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
                <div className="loading">견적 정보를 불러오는 중...</div>
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
              <h3>Lightning ↔ eCash 전환</h3>
              <button onClick={() => setShowConvert(false)} aria-label="닫기"><Icon name="close" size={20} /></button>
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
                <label>전환할 금액 (sats)</label>
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
                      {t('wallet.fee')}: {Math.ceil(convertAmount * ECASH_CONFIG.feeRate)} sats
                      <br />
                      {t('wallet.actualConversion')}: {Math.max(0, convertAmount - Math.ceil(convertAmount * ECASH_CONFIG.feeRate))} sats
                    </>
                  )}
                </small>
              </div>
              <div className="conversion-info">
                <div className="info-item">
                  <Icon name="info" size={16} />
                  <span>{t('wallet.conversionFee')}: {(ECASH_CONFIG.feeRate * 100).toFixed(1)}%</span>
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
                  {loading ? '전환 중...' : '전환하기'}
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
              <h3>{passphraseAction === 'backup' ? '암호화 백업' : '암호화된 백업 복구'}</h3>
              <button onClick={() => { setShowPassphraseModal(false); setPassphrase(''); setPassphraseConfirm(''); }} aria-label={t('common.close')}>
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="modal-body">
              {passphraseAction === 'backup' ? (
                <>
                  <div className="input-group">
                    <label>패스프레이즈 (최소 8자)</label>
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="안전한 패스프레이즈를 입력하세요"
                      minLength="8"
                    />
                    <small>이 패스프레이즈는 백업 파일 복구 시 필요합니다. 안전하게 보관하세요.</small>
                  </div>
                  <div className="input-group">
                    <label>패스프레이즈 확인</label>
                    <input
                      type="password"
                      value={passphraseConfirm}
                      onChange={(e) => setPassphraseConfirm(e.target.value)}
                      placeholder="패스프레이즈를 다시 입력하세요"
                      minLength="8"
                    />
                  </div>
                  <div className="modal-actions">
                    <button
                      className="primary-btn"
                      onClick={executeBackup}
                      disabled={loading || !passphrase || passphrase !== passphraseConfirm}
                    >
                      {loading ? '암호화 중...' : '백업 다운로드'}
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
                    <label>패스프레이즈</label>
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="백업 시 사용한 패스프레이즈를 입력하세요"
                    />
                    <small>암호화된 백업 파일을 복구하려면 백업 시 사용한 패스프레이즈가 필요합니다.</small>
                  </div>
                  <div className="modal-actions">
                    <button
                      className="primary-btn"
                      onClick={executeRestore}
                      disabled={loading || !passphrase}
                    >
                      {loading ? '복구 중...' : '복구하기'}
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
                      <strong>거래 일시</strong>
                      <p>{formatDate(selectedTx.timestamp)}</p>
                    </div>
                  </div>
                  <div className="tx-detail-item">
                    <Icon name={selectedTx.type === 'receive' ? 'inbox' : selectedTx.type === 'send' ? 'send' : 'repeat'} size={18} />
                    <div>
                      <strong>거래 유형</strong>
                      <p>{selectedTx.type === 'receive' ? '수신' : selectedTx.type === 'send' ? '송신' : '전환'}</p>
                    </div>
                  </div>
                  <div className="tx-detail-item">
                    <Icon name="info" size={18} />
                    <div>
                      <strong>상태</strong>
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
                      <strong>거래 ID</strong>
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
            {t('wallet.ecashHoldings')} ({t('wallet.ecashCount', { count: loadProofs().length })})
          </h3>
          <div onClick={() => setShowProofs(!showProofs)} style={{ cursor: 'pointer' }}>
            <Icon name={showProofs ? 'chevron-up' : 'chevron-down'} size={20} />
          </div>
        </div>
        {showProofs && (
          <div className="proofs-list">
            {loadProofs().length === 0 ? (
              <div className="empty-state">{t('wallet.noEcash')}</div>
            ) : (
              loadProofs().map((proof, index) => {
                const isValid = proof?.amount > 0 && proof?.secret && (proof?.id || proof?.C);
                const mintUrl = proof?.mintUrl || 'Unknown Mint';
                const displayMintUrl = mintUrl.length > 40 ? mintUrl.substring(0, 37) + '...' : mintUrl;

                return (
                  <div key={proof?.secret || index} className="proof-item">
                    <div className="proof-info">
                      <div className="proof-amount-status">
                        <span className="proof-amount">{formatAmount(proof?.amount || 0)} sats</span>
                        <div className={`proof-status ${isValid ? 'valid' : 'invalid'}`}>
                          {isValid ? t('wallet.valid') : t('wallet.invalid')}
                        </div>
                      </div>
                    </div>
                    <div className="proof-mint" style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                      Mint: <span className="monospace" title={mintUrl}>{displayMintUrl}</span>
                    </div>
                    <div className="proof-secret">
                      Secret: <span className="monospace">{(proof?.secret || '').substring(0, 16)}...</span>
                    </div>
                    <div className="proof-id monospace">
                      ID: {(proof?.id || proof?.C || '').substring(0, 12)}...
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </>
      )}

      {/* QR Code Modal */}
      {showQrModal && (invoice || ecashRequest) && (
        <div className="qr-modal-overlay" onClick={() => setShowQrModal(false)}>
          <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={() => setShowQrModal(false)} aria-label="Close">
              <Icon name="close" size={24} />
            </button>
            <div className="qr-modal-body">
              <h3>{formatAmount(receiveAmount)} sats</h3>
              <div className="qr-modal-code">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=H&data=${encodeURIComponent(
                    receiveTab === 'lightning'
                      ? ((invoice || '').toLowerCase().startsWith('ln') ? 'lightning:' + invoice : invoice)
                      : ecashRequest
                  )}`}
                  alt={receiveTab === 'lightning' ? "Lightning Invoice QR Code" : "eCash Request QR Code"}
                />
                <div className="qr-logo-overlay">
                  <img src="/logo-192.png" alt="Logo" className="qr-logo" />
                </div>
              </div>
              <p className="qr-mint-info" style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                Mint: {mintUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </p>
              <p className="qr-modal-hint">{receiveTab === 'lightning' ? t('wallet.scanQrToPayHint') : t('wallet.scanQrToPayEcashHint')}</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default Wallet;
