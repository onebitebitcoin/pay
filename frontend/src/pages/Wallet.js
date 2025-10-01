import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DEFAULT_MINT_URL, ECASH_CONFIG } from '../config';
// Cashu mode: no join/federation or gateway UI
import { getBalanceSats, selectProofsForAmount, addProofs, removeProofs, loadProofs, saveProofs, exportProofsJson, importProofsFrom } from '../services/cashu';
import { createBlindedOutputs, signaturesToProofs } from '../services/cashuProtocol';
import './Wallet.css';
import Icon from '../components/Icon';
import QrScanner from '../components/QrScanner';

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

// Prevent duplicate "Mint에 연결되었습니다" toasts in StrictMode/dev
let MINT_CONNECTED_TOAST_SHOWN = false;

function Wallet() {
  const [balance, setBalance] = useState(0);
  const [ecashBalance, setEcashBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const TX_STORAGE_KEY = 'cashu_tx_v1';
  const [lightningReady, setLightningReady] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  // Cashu mode: no explicit join modal
  const [receiveAmount, setReceiveAmount] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [convertAmount, setConvertAmount] = useState('');
  const [convertDirection, setConvertDirection] = useState('ln_to_ecash'); // 'ln_to_ecash' or 'ecash_to_ln'
  const [sendAddress, setSendAddress] = useState('');
  const [enableSendScanner, setEnableSendScanner] = useState(false);
  const [invoice, setInvoice] = useState('');
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [checkAttempts, setCheckAttempts] = useState(0);
  const redeemTimerRef = useRef(null);
  const redeemCtxRef = useRef(null); // { outputs, outputDatas, mintKeys, amount, quote }
  const redeemInFlightRef = useRef(false);
  const fileInputRef = useRef(null);
  const [receiveCompleted, setReceiveCompleted] = useState(false);
  const [receivedAmount, setReceivedAmount] = useState(0);
  const [showEcashInfo, setShowEcashInfo] = useState(false);
  const [showPassphraseModal, setShowPassphraseModal] = useState(false);
  const [passphraseAction, setPassphraseAction] = useState('backup'); // 'backup' or 'restore'
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [showTxDetail, setShowTxDetail] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);

  // Storage warnings
  const [storageHealthy, setStorageHealthy] = useState(true);
  const [showBackupBanner, setShowBackupBanner] = useState(false);

  // Mint connection status
  const [isConnected, setIsConnected] = useState(false);
  const [mintUrl, setMintUrl] = useState('');
  // Removed inline mint explainer (moved to About page)

  useEffect(() => {
    // Display default mint url (Cashu)
    setMintUrl(DEFAULT_MINT_URL);
    // Auto-connect by checking mint info
    connectMint();
    // Load transactions from storage
    try {
      const raw = localStorage.getItem(TX_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setTransactions(arr);
    } catch {}
    return () => {
      try { stopAutoRedeem(); } catch {}
    };
  }, []);

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
    // Show backup banner when there is balance and not dismissed
    try {
      const dismissed = localStorage.getItem('cashu_backup_dismissed') === '1';
      setShowBackupBanner(!dismissed && ecashBalance > 0);
    } catch {
      setShowBackupBanner(ecashBalance > 0);
    }
  }, [ecashBalance]);

  useEffect(() => {
    if (showSend) {
      setEnableSendScanner(true);
    } else {
      setEnableSendScanner(false);
    }
  }, [showSend]);

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

  const loadWalletData = async () => {
    try {
      setLoading(true);
      try { importProofsFrom(loadProofs()); } catch {}
      setEcashBalance(getBalanceSats());
      setLightningReady(true);
    } catch (error) {
      console.error('지갑 데이터 로드 오류:', error);
      setLightningReady(false);
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
      alert('패스프레이즈는 최소 8자 이상이어야 합니다.');
      return;
    }
    if (passphrase !== passphraseConfirm) {
      alert('패스프레이즈가 일치하지 않습니다.');
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
      addToast('암호화된 백업 파일을 다운로드했습니다', 'success');
      try { localStorage.setItem('cashu_backup_dismissed', '1'); setShowBackupBanner(false); } catch {}
    } catch (e) {
      console.error('Backup failed:', e);
      addToast('백업 실패: ' + e.message, 'error');
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
        addToast(`복구 완료: ${added}건 추가, 총 ${total}건`, 'success');
      }
    } catch (e) {
      console.error('Restore failed:', e);
      addToast('복구 실패: 잘못된 파일입니다', 'error');
    } finally {
      try { e.target.value = ''; } catch {}
    }
  };

  const executeRestore = async () => {
    if (!passphrase) {
      alert('패스프레이즈를 입력하세요.');
      return;
    }

    try {
      setLoading(true);
      const encryptedData = window._pendingRestoreData;
      if (!encryptedData) {
        throw new Error('복구할 데이터가 없습니다.');
      }

      const decrypted = await decryptData(encryptedData, passphrase);
      const { added, total } = importProofsFrom(decrypted);
      setEcashBalance(getBalanceSats());

      setShowPassphraseModal(false);
      setPassphrase('');
      window._pendingRestoreData = null;
      addToast(`복구 완료: ${added}건 추가, 총 ${total}건`, 'success');
    } catch (e) {
      console.error('Restore failed:', e);
      addToast('복구 실패: 패스프레이즈가 올바르지 않거나 파일이 손상되었습니다', 'error');
    } finally {
      setLoading(false);
    }
  };

  const addToast = useCallback((message, type = 'success', timeout = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    if (timeout) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, timeout);
    }
  }, []);

  const handleSendQrScan = useCallback((rawValue) => {
    const normalized = normalizeQrValue(rawValue);
    if (!normalized) {
      addToast('QR 코드에서 유효한 값을 찾지 못했습니다', 'error', 3000);
      return;
    }
    setSendAddress(normalized);
    setEnableSendScanner(false);
    addToast('QR 코드를 불러왔습니다', 'info', 2500);
  }, [addToast]);

  const handleSendQrError = useCallback((err) => {
    console.error('QR scanner error:', err);
    const message = err && err.message ? err.message : 'QR 스캔 기능을 사용할 수 없습니다';
    addToast(message, 'error', 3500);
  }, [addToast]);

  const persistTransactions = (list) => {
    try { localStorage.setItem(TX_STORAGE_KEY, JSON.stringify(list || [])); } catch {}
  };
  const addTransaction = (tx) => {
    setTransactions((prev) => {
      const next = [tx, ...(Array.isArray(prev) ? prev : [])];
      persistTransactions(next);
      return next;
    });
  };

  const generateInvoice = async () => {
    if (!receiveAmount || receiveAmount <= 0) {
      alert('올바른 금액을 입력하세요');
      return;
    }

    try {
      setLoading(true);
      setReceiveCompleted(false);
      const resp = await fetch('http://localhost:5001/api/cashu/mint/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseInt(receiveAmount, 10) })
      });
      if (!resp.ok) {
        let msg = '인보이스 생성 실패';
        try { const err = await resp.json(); if (err?.error) msg = err.error; } catch {}
        throw new Error(msg);
      }
      const data = await resp.json();
      const req = data?.request || data?.payment_request || '';
      const quoteId = data?.quote || data?.quote_id || '';
      setInvoice(req);
      localStorage.setItem('cashu_last_quote', quoteId);
      localStorage.setItem('cashu_last_mint_amount', String(parseInt(receiveAmount, 10)));
      if (quoteId) startAutoRedeem(quoteId);
    } catch (error) {
      console.error('인보이스 생성 오류:', error);
      alert('인보이스 생성에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const hasQuoteRedeemed = (q) => {
    try {
      const raw = localStorage.getItem('cashu_redeemed_quotes') || '[]';
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.includes(q);
    } catch { return false; }
  };

  const markQuoteRedeemed = (q) => {
    try {
      const raw = localStorage.getItem('cashu_redeemed_quotes') || '[]';
      const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
      if (!arr.includes(q)) arr.push(q);
      localStorage.setItem('cashu_redeemed_quotes', JSON.stringify(arr));
    } catch {}
  };

  const startAutoRedeem = (quote) => {
    try { stopAutoRedeem(); } catch {}
    setCheckingPayment(true);
    setCheckAttempts(0);
    const MAX_ATTEMPTS = 60; // ~2 minutes at 2s interval
    let attempts = 0;
    redeemCtxRef.current = null;
    if (hasQuoteRedeemed(quote)) {
      setReceiveCompleted(true);
      setCheckingPayment(false);
      return;
    }
    redeemTimerRef.current = setInterval(async () => {
      try {
        if (redeemInFlightRef.current || receiveCompleted) return;
        attempts += 1;
        setCheckAttempts(attempts);
        if (attempts >= MAX_ATTEMPTS) {
          stopAutoRedeem();
          addToast('결제가 아직 확인되지 않았습니다. 나중에 다시 확인해주세요.', 'info');
          return;
        }
        // Check quote state to get actual paid/issued amount before building outputs
        // If not paid yet, skip this cycle
        try {
          const cs = await fetch(`http://localhost:5001/api/cashu/mint/quote/check?quote=${encodeURIComponent(quote)}`);
          if (cs.ok) {
            const st = await cs.json();
            const s = (st?.state || '').toUpperCase();
            if (s && s !== 'PAID' && s !== 'ISSUED') {
              return; // unpaid/pending
            }
          }
        } catch {}
        redeemInFlightRef.current = true;
        // Ensure we have mint keys and prebuilt blinded outputs once (for the correct amount)
        if (!redeemCtxRef.current) {
          const keysResp = await fetch('http://localhost:5001/api/cashu/keys');
          if (!keysResp.ok) throw new Error('Mint keys 조회 실패');
          const mintKeys = await keysResp.json();
          let amount = parseInt(localStorage.getItem('cashu_last_mint_amount') || '0', 10);
          try {
            const js = await fetch(`http://localhost:5001/api/cashu/mint/quote/check?quote=${encodeURIComponent(quote)}`);
            if (js.ok) {
              const jd = await js.json();
              amount = parseInt(jd?.amount_issued || jd?.amount || amount || 0, 10);
            }
          } catch {}
          const { outputs, outputDatas } = await createBlindedOutputs(amount, mintKeys);
          redeemCtxRef.current = { outputs, outputDatas, mintKeys, amount, quote };
        }
        const { outputs, outputDatas, mintKeys } = redeemCtxRef.current;
        const r = await fetch('http://localhost:5001/api/cashu/mint/redeem', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quote, outputs })
        });
        if (!r.ok) {
          // Try to parse error, keep polling if just 'not paid yet'
          try {
            const err = await r.json();
            const emsg = (typeof err?.error === 'string') ? err.error : JSON.stringify(err?.error || err);
            if (emsg && /not\s*paid|unpaid|pending/i.test(emsg)) {
              redeemInFlightRef.current = false;
              return; // continue polling silently
            }
            if (/extra\s*fields|field\s*required|validation/i.test(emsg)) {
              // likely request shape issue or invalid/expired quote; stop polling
              stopAutoRedeem();
              addToast(`결제 확인 실패: ${emsg}`, 'error');
              return;
            }
            // Other validation errors: show once and stop
            stopAutoRedeem();
            addToast(`결제 확인 실패: ${emsg}`, 'error');
          } catch {
            // Unknown error; keep polling to be resilient
          }
          redeemInFlightRef.current = false;
          return;
        }
        const rd = await r.json();
        // Expect 'signatures' or 'promises'
        const signatures = rd?.signatures || rd?.promises || [];
        if (Array.isArray(signatures) && signatures.length) {
          const proofs = await signaturesToProofs(signatures, mintKeys, outputDatas);
          stopAutoRedeem();
          addProofs(proofs);
          const added = proofs.reduce((s, p) => s + Number(p?.amount || 0), 0);
          setEcashBalance(getBalanceSats());
          setReceivedAmount(added);
          setReceiveCompleted(true);
          markQuoteRedeemed(quote);
          addTransaction({
            id: Date.now(),
            type: 'receive',
            amount: added,
            timestamp: new Date().toISOString(),
            status: 'confirmed',
            description: '라이트닝 수신'
          });
        }
        redeemInFlightRef.current = false;
      } catch {
        // swallow and retry
        redeemInFlightRef.current = false;
      }
    }, 2000);
  };

  const stopAutoRedeem = () => {
    if (redeemTimerRef.current) {
      clearInterval(redeemTimerRef.current);
      redeemTimerRef.current = null;
    }
    setCheckingPayment(false);
  };

  const isBolt11Invoice = (val) => {
    if (!val || typeof val !== 'string') return false;
    const s = val.trim().toLowerCase().replace(/^lightning:/, '');
    return s.startsWith('lnbc') || s.startsWith('lntb') || s.startsWith('lno');
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

  // Send confirmation state
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const sendCtxRef = useRef(null); // { bolt11, quoteData }

  const prepareSend = async () => {
    if (enableSendScanner) {
      setEnableSendScanner(false);
    }
    const hasInvoice = isBolt11Invoice(sendAddress);
    const hasAddress = isLightningAddress(sendAddress);
    if (!hasInvoice && !hasAddress) {
      alert('라이트닝 인보이스(lnbc...) 또는 라이트닝 주소(user@domain)를 입력하세요');
      return;
    }

    try {
      setLoading(true);
      // Resolve invoice if address provided
      let bolt11 = hasInvoice ? normalizeBolt11(sendAddress) : '';
      if (!bolt11 && hasAddress) {
        const amt = parseInt(sendAmount, 10);
        if (!amt || amt <= 0) throw new Error('금액이 필요합니다');
        const rq = await fetch('http://localhost:5001/api/lightningaddr/quote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: sendAddress, amount: amt })
        });
        if (!rq.ok) {
          let msg = '주소 인보이스 발급 실패';
          try { const err = await rq.json(); if (err?.error) msg = err.error; } catch {}
          throw new Error(msg);
        }
        const rqj = await rq.json();
        bolt11 = rqj?.request;
        if (!bolt11) throw new Error('인보이스 발급 실패');
      }
      // quote for bolt11
      const q = await fetch('http://localhost:5001/api/cashu/melt/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: bolt11, invoice: bolt11 })
      });
      if (!q.ok) {
        let msg = '견적 요청 실패';
        try {
          const err = await q.json();
          if (err?.error) {
            try {
              const inner = JSON.parse(err.error);
              if (inner?.detail?.[0]?.msg) msg = inner.detail[0].msg;
              else msg = err.error;
            } catch { msg = err.error; }
          }
        } catch {}
        throw new Error(msg);
      }
      const qd = await q.json();
      const invoiceAmount = Number(qd?.amount || 0);
      const feeReserve = Number(qd?.fee_reserve || qd?.fee || 0);
      const need = invoiceAmount + feeReserve;
      const available = getBalanceSats();

      sendCtxRef.current = { bolt11, quoteData: qd };
      // Show confirmation modal
      setShowSendConfirm(true);
      // Attach computed details to stateful helpers
      setPendingSendDetails({
        invoiceAmount, feeReserve, need, available
      });
    } catch (error) {
      console.error('송금 오류:', error);
      addToast(error?.message || '송금에 실패했습니다', 'error');
    } finally {
      setLoading(false);
    }
  };

  const [pendingSendDetails, setPendingSendDetails] = useState(null);

  const confirmSend = async () => {
    try {
      setLoading(true);
      const { quoteData } = sendCtxRef.current || {};
      if (!quoteData) throw new Error('견적 정보가 없습니다');
      const invoiceAmount = Number(quoteData?.amount || 0);
      const feeReserve = Number(quoteData?.fee_reserve || quoteData?.fee || 0);
      const need = invoiceAmount + feeReserve;
      const { ok, picked, total } = selectProofsForAmount(need);
      if (!ok) throw new Error('eCash 잔액이 부족합니다');
      // Prepare change outputs if necessary
      let changeOutputs = undefined;
      let changeOutputDatas = undefined;
      const change = Math.max(0, Number(total) - Number(need));
      if (change > 0) {
        const kr = await fetch('http://localhost:5001/api/cashu/keys');
        if (!kr.ok) throw new Error('Mint keys 조회 실패');
        const mintKeys = await kr.json();
        const built = await createBlindedOutputs(change, mintKeys);
        changeOutputs = built.outputs;
        changeOutputDatas = built.outputDatas;
      }
      // Deduplicate inputs defensively
      const uniquePicked = Array.from(new Map(picked.map(p => [p?.secret || JSON.stringify(p), p])).values());
      const m = await fetch('http://localhost:5001/api/cashu/melt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote: quoteData?.quote || quoteData?.quote_id, inputs: uniquePicked, outputs: changeOutputs })
      });
      if (!m.ok) {
        let msg = '송금 실패';
        try {
          const err = await m.json();
          if (err?.error) {
            try {
              const inner = JSON.parse(err.error);
              if (inner?.code === 11007 || /duplicate inputs?/i.test(inner?.detail || '')) {
                msg = '중복된 증명서(inputs)가 포함되었습니다. 새로고침 후 다시 시도하세요.';
              } else if (inner?.detail?.[0]?.msg) msg = inner.detail[0].msg;
              else msg = err.error;
            } catch { msg = err.error; }
          }
        } catch {}
        throw new Error(msg);
      }
      const md = await m.json();
      // Process change promises if any
      let changeProofs = [];
      const signatures = md?.change || md?.signatures || md?.promises || [];
      if (Array.isArray(signatures) && signatures.length && changeOutputDatas) {
        const kr2 = await fetch('http://localhost:5001/api/cashu/keys');
        const mintKeys2 = kr2.ok ? await kr2.json() : null;
        if (mintKeys2) {
          changeProofs = await signaturesToProofs(signatures, mintKeys2, changeOutputDatas);
        }
      }
      removeProofs(picked);
      if (changeProofs.length) addProofs(changeProofs);
      setEcashBalance(getBalanceSats());
      await loadWalletData();
      addTransaction({
        id: Date.now(),
        type: 'send',
        amount: -(pendingSendDetails?.invoiceAmount || 0),
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        description: '라이트닝 송금'
      });
      setSendAmount('');
      setSendAddress('');
      setShowSend(false);
      setEnableSendScanner(false);
      setShowSendConfirm(false);
      setPendingSendDetails(null);
      addToast('라이트닝 송금이 완료되었습니다', 'success');
    } catch (error) {
      console.error('송금 오류:', error);
      addToast(error?.message || '송금에 실패했습니다', 'error');
    } finally {
      setLoading(false);
    }
  };

  const convertFunds = async () => {
    if (!convertAmount || convertAmount <= 0) {
      alert('올바른 금액을 입력하세요');
      return;
    }

    const amount = parseInt(convertAmount);
    const fee = Math.ceil(amount * ECASH_CONFIG.feeRate);

    if (convertDirection === 'ln_to_ecash') {
      if (amount > balance) {
        alert('Lightning 잔액이 부족합니다');
        return;
      }
    } else {
      if (amount > ecashBalance) {
        alert('eCash 잔액이 부족합니다');
        return;
      }
    }

    if (amount > ECASH_CONFIG.maxAmount) {
      alert(`최대 ${formatAmount(ECASH_CONFIG.maxAmount)} sats까지 전환 가능합니다`);
      return;
    }

    try {
      setLoading(true);
      // Cashu 모드에서는 받기/보내기 플로우로 전환이 처리됩니다.
      alert('Cashu 모드에서는 전환 모달은 별도로 사용하지 않습니다. 받기/보내기를 이용해 주세요.');
    } catch (error) {
      console.error('전환 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  const connectMint = async () => {
    try {
      setLoading(true);
      const resp = await fetch('http://localhost:5001/api/cashu/info');
      if (!resp.ok) throw new Error('Mint 정보 조회 실패');
      setIsConnected(true);
      await loadWalletData();
      if (!MINT_CONNECTED_TOAST_SHOWN) {
        addToast('Mint에 연결되었습니다', 'info');
        MINT_CONNECTED_TOAST_SHOWN = true;
      }
    } catch (e) {
      console.error(e);
      alert(e.message || 'Mint 연결 실패');
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (sats) => {
    return new Intl.NumberFormat('ko-KR').format(sats);
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <>
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
      ))}
    </div>
    <div className="wallet">
      <div className="wallet-header">
        <h1><Icon name="shield" size={22} /> 한입 지갑</h1>
        <p>Cashu 기반 프라이버시 중심 비트코인 지갑</p>
      </div>

      {/* Storage warning banners */}
      {!storageHealthy && (
        <div className="warning-banner danger">
          <div>
            <strong>저장소 접근 불가</strong> · 이 브라우저에서 eCash를 안전하게 보관할 수 없습니다. 다른 브라우저를 사용하거나, 즉시 백업 후 종료하세요.
          </div>
        </div>
      )}
      {storageHealthy && showBackupBanner && (
        <div className="warning-banner warning">
          <div>
            <strong>중요</strong> · 브라우저 데이터 삭제 시 eCash 잔액이 사라집니다. 지금 백업 파일을 내려받아 안전하게 보관하세요.
          </div>
          <div className="warning-actions">
            <button className="warning-btn primary" onClick={handleBackup}>백업</button>
            <button className="warning-btn" onClick={() => { try { localStorage.setItem('cashu_backup_dismissed', '1'); } catch {}; setShowBackupBanner(false); }}>나중에</button>
          </div>
        </div>
      )}

      {/* Connection Status (minimal) */}
      <div className="connection-status minimal">
        <div className="status-indicator">
          <span className={`status-dot ${isConnected ? 'on' : 'off'}`}></span>
          <small className="status-text">{isConnected ? '연결됨' : '연결 안됨'}</small>
        </div>
        {!isConnected && (
          <button onClick={connectMint} className="connect-btn" disabled={loading}>
            Mint 연결
          </button>
        )}
      </div>

      {/* Mint explainer moved to About page for clarity */}


      {/* Single Balance Card (eCash as primary) */}
      <div className="balance-cards">
        <div className="balance-card ecash-card">
          <div className="balance-header">
            <div className="balance-info">
              <h3>
                <Icon name="shield" size={20} /> 잔액
              </h3>
              <div className="balance-amount">
                {formatAmount(ecashBalance)} <span className="unit">sats</span>
              </div>
            </div>
            <div className="balance-manage">
              <button className="icon-btn" onClick={handleBackup} title="백업">
                <Icon name="download" size={18} />
              </button>
              <button className="icon-btn" onClick={() => fileInputRef.current?.click()} title="복구">
                <Icon name="upload" size={18} />
              </button>
              <button
                className="icon-btn"
                onClick={() => setShowEcashInfo(!showEcashInfo)}
                title="eCash 정보"
              >
                <Icon name="info" size={18} />
              </button>
              <input type="file" accept="application/json" ref={fileInputRef} style={{ display: 'none' }} onChange={handleRestoreFile} />
            </div>
          </div>
          {showEcashInfo && (
            <div className="ecash-info-box">
              <h4><Icon name="shield" size={16} /> eCash란?</h4>
              <p>eCash는 Cashu 프로토콜을 사용하는 디지털 현금입니다. Mint 서버가 발행하는 암호화된 토큰으로, 라이트닝 네트워크와 연동되어 빠르고 저렴한 결제가 가능합니다.</p>
              <h4><Icon name="info" size={16} /> 주요 특징</h4>
              <ul>
                <li><strong>프라이버시:</strong> 거래 내역이 블록체인에 기록되지 않습니다</li>
                <li><strong>즉시 결제:</strong> 라이트닝 네트워크를 통한 빠른 송수신</li>
                <li><strong>낮은 수수료:</strong> 소액 결제에 최적화</li>
                <li><strong>수탁형이 아님:</strong> 토큰은 브라우저에만 저장되며, 가상자산 신고 대상이 아닙니다</li>
              </ul>
            </div>
          )}
          <div className="balance-actions">
            <button
              onClick={() => setShowReceive(true)}
              className="action-btn receive-btn"
              disabled={!isConnected}
            >
              <Icon name="inbox" size={16} /> 받기
            </button>
            <button
              onClick={() => {
                setEnableSendScanner(true);
                setShowSend(true);
              }}
              className="action-btn send-btn"
              disabled={!isConnected || ecashBalance === 0}
            >
              <Icon name="send" size={16} /> 보내기
            </button>
          </div>
        </div>
      </div>

      {/* Receive Modal */}
      {showReceive && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>라이트닝 받기</h3>
              <button onClick={() => { try { stopAutoRedeem(); } catch {} setReceiveCompleted(false); setReceivedAmount(0); setInvoice(''); setShowReceive(false); }} aria-label="닫기"><Icon name="close" size={20} /></button>
            </div>
            <div className="modal-body">
              {!receiveCompleted ? (
                <>
                  <div className="input-group">
                    <label>받을 금액 (sats)</label>
                    <input
                      type="number"
                      value={receiveAmount}
                      onChange={(e) => setReceiveAmount(e.target.value)}
                      placeholder="10000"
                      min="1"
                    />
                  </div>
                  {invoice && (
                    <div className="invoice-section">
                      <label>라이트닝 인보이스</label>
                      <div className="input-with-action">
                        <input
                          type="text"
                          value={invoice}
                          readOnly
                          className="invoice-input"
                          onFocus={(e) => e.target.select()}
                        />
                        <button
                          type="button"
                          aria-label="인보이스 복사"
                          className="copy-icon-btn"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(invoice);
                              if (typeof addToast === 'function') addToast('인보이스를 복사했습니다', 'info');
                            } catch {
                              alert('복사에 실패했습니다');
                            }
                          }}
                        >
                          <Icon name="copy" size={18} />
                        </button>
                      </div>
                      {checkingPayment && (
                        <div className="payment-checking">
                          결제 확인 중... (시도 {checkAttempts}회)
                          <button
                            type="button"
                            className="link-btn"
                            onClick={stopAutoRedeem}
                          >중지</button>
                        </div>
                      )}
                      <div className="qr-placeholder">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent((invoice || '').toLowerCase().startsWith('ln') ? 'lightning:' + invoice : invoice)}`}
                          alt="Lightning Invoice QR"
                          className="qr-image"
                        />
                        <small>QR 코드로 스캔하여 결제해 주세요. 결제되면 자동으로 수신 처리됩니다.</small>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="payment-success">
                  <div className="success-checkmark">
                    <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                      <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
                      <path className="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                    </svg>
                  </div>
                  <h2 className="success-title">수신 완료!</h2>
                  <p className="success-amount">
                    <span className="amount-value">{formatAmount(receivedAmount)}</span> sats
                  </p>
                  <p className="success-message">
                    라이트닝 결제를 성공적으로 받았습니다!
                  </p>
                  <button
                    className="primary-btn"
                    onClick={() => {
                      setReceiveCompleted(false);
                      setReceivedAmount(0);
                      setInvoice('');
                      setShowReceive(false);
                    }}
                    style={{marginTop: '1.5rem'}}
                  >
                    확인
                  </button>
                </div>
              )}
              <div className="modal-actions">
                {!receiveCompleted && (
                  <button 
                    onClick={generateInvoice} 
                    className="primary-btn"
                    disabled={loading || !receiveAmount || !!invoice}
                  >
                    {loading ? '생성 중...' : '인보이스 생성'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send Modal */}
      {showSend && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>라이트닝 보내기</h3>
              <button onClick={() => { setEnableSendScanner(false); setShowSend(false); }} aria-label="닫기"><Icon name="close" size={20} /></button>
            </div>
            <div className="modal-body">
              {enableSendScanner && (
                <QrScanner onScan={handleSendQrScan} onError={handleSendQrError} />
              )}
              <div className="input-group">
                <label>보낼 금액 (sats)</label>
                <input
                  type="number"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  placeholder="인보이스에 금액이 포함된 경우 비활성화됩니다"
                  min="1"
                  max={ecashBalance}
                  disabled={isBolt11Invoice(sendAddress)}
                />
                <small>
                  사용 가능: {formatAmount(ecashBalance)} sats{isBolt11Invoice(sendAddress) ? ' · 인보이스 금액이 사용됩니다' : ''}
                </small>
              </div>
              <div className="input-group">
                <label>라이트닝 인보이스 또는 주소</label>
                <textarea
                  value={sendAddress}
                  onChange={(e) => setSendAddress(e.target.value)}
                  placeholder={isBolt11Invoice(sendAddress) ? 'lnbc...' : 'user@domain 또는 lnbc...'}
                  rows="3"
                />
                <small>
                  {isBolt11Invoice(sendAddress)
                    ? '인보이스가 감지되었습니다'
                    : isLightningAddress(sendAddress)
                      ? '라이트닝 주소가 감지되었습니다'
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
              <div className="modal-actions">
                 <button
                  onClick={prepareSend}
                  className="primary-btn"
                  disabled={
                    loading || (!isBolt11Invoice(sendAddress) && !(isLightningAddress(sendAddress) && Number(sendAmount) > 0))
                  }
                >
                  {loading ? '송금 중...' : '송금하기'}
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
                    <div className="info-item"><Icon name="bolt" size={16} /> 인보이스 금액: {formatAmount(pendingSendDetails.invoiceAmount)} sats</div>
                    <div className="info-item"><Icon name="info" size={16} /> 수수료 예치: {formatAmount(pendingSendDetails.feeReserve)} sats</div>
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
                      {loading ? '송금 중...' : '확인'}
                    </button>
                    <button className="secondary-btn" onClick={() => setShowSendConfirm(false)} disabled={loading}>취소</button>
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
                  max={convertDirection === 'ln_to_ecash' ? balance : ecashBalance}
                />
                <small>
                  사용 가능: {formatAmount(convertDirection === 'ln_to_ecash' ? balance : ecashBalance)} sats
                  {convertAmount && (
                    <>
                      <br />
                      수수료: {Math.ceil(convertAmount * ECASH_CONFIG.feeRate)} sats
                      <br />
                      실제 전환: {Math.max(0, convertAmount - Math.ceil(convertAmount * ECASH_CONFIG.feeRate))} sats
                    </>
                  )}
                </small>
              </div>
              <div className="conversion-info">
                <div className="info-item">
                  <Icon name="info" size={16} />
                  <span>전환 수수료: {(ECASH_CONFIG.feeRate * 100).toFixed(1)}%</span>
                </div>
                <div className="info-item">
                  <Icon name="clock" size={16} />
                  <span>예상 시간: 2-3초</span>
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
              <button onClick={() => { setShowPassphraseModal(false); setPassphrase(''); setPassphraseConfirm(''); }} aria-label="닫기">
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
                      취소
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
                      취소
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
              <h3>거래 상세 정보</h3>
              <button onClick={() => { setShowTxDetail(false); setSelectedTx(null); }} aria-label="닫기">
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
                  <p className="tx-detail-type">{selectedTx.description}</p>
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
                      <p className="tx-status-badge">{selectedTx.status === 'confirmed' ? '완료' : '대기 중'}</p>
                    </div>
                  </div>
                  {selectedTx.actualAmount && (
                    <>
                      <div className="tx-detail-item">
                        <Icon name="diamond" size={18} />
                        <div>
                          <strong>실제 전환 금액</strong>
                          <p>{formatAmount(selectedTx.actualAmount)} sats</p>
                        </div>
                      </div>
                      <div className="tx-detail-item">
                        <Icon name="bolt" size={18} />
                        <div>
                          <strong>수수료</strong>
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
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div className="transactions">
        <h3>거래 내역</h3>
        {loading ? (
          <div className="loading">거래 내역을 불러오는 중...</div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">거래 내역이 없습니다</div>
        ) : (
          <div className="transaction-list">
            {transactions.map(tx => (
              <div key={tx.id} className={`transaction-item ${tx.type}`}>
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
                  <div className="tx-description">{tx.description}</div>
                  <div className="tx-date">{formatDate(tx.timestamp)}</div>
                  {tx.actualAmount && (
                    <div className="tx-conversion-details">
                      실제 전환: {formatAmount(tx.actualAmount)} sats | 수수료: {formatAmount(tx.fee)} sats
                    </div>
                  )}
                </div>
                <div className="tx-amount-container">
                  <div className={`tx-amount ${tx.amount > 0 ? 'positive' : 'negative'}`}>
                    {tx.type === 'convert' ? (
                      <span className="convert-amount">
                        {formatAmount(Math.abs(tx.amount))} sats
                      </span>
                    ) : (
                      <>
                        {tx.amount > 0 ? '+' : ''}{formatAmount(Math.abs(tx.amount))} sats
                      </>
                    )}
                  </div>
                  <button
                    className="tx-detail-btn"
                    onClick={() => {
                      setSelectedTx(tx);
                      setShowTxDetail(true);
                    }}
                  >
                    <Icon name="info" size={14} /> 자세히
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    
    </>
  );
}

export default Wallet;
