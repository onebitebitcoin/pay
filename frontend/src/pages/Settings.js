import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DEFAULT_MINT_URL } from '../config';
import './Settings.css';
import Icon from '../components/Icon';
import { applyTheme, normalizeTheme } from '../utils/theme';

const MIN_RECEIVE_SATS = 100;
const MINT_QUOTE_TIMEOUT_MS = 7000;
const MINT_QUOTE_UNIT = 'sat';

const verifyMintOperational = async (normalizedUrl) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MINT_QUOTE_TIMEOUT_MS);
  try {
    const response = await fetch(`${normalizedUrl}/v1/mint/quote/bolt11`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: MIN_RECEIVE_SATS, unit: MINT_QUOTE_UNIT }),
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error('Mint quote failed');
      error.code = 'QUOTE_HTTP_ERROR';
      error.status = response.status;
      try {
        error.details = await response.text();
      } catch (_) {
        error.details = '';
      }
      throw error;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!payload || (!payload.quote && !payload.quote_id)) {
      const error = new Error('Mint quote invalid');
      error.code = 'QUOTE_INVALID';
      error.details = payload;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
};

function Settings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [settings, setSettings] = useState({
    walletName: '',
    language: 'ko',
    theme: 'light',
    currency: 'SATS',
    notifications: true,
    mintUrl: '',
    backupMintUrl: '',
    autoBackup: false,
    pinEnabled: false
  });

  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [pinStep, setPinStep] = useState('current'); // 'current', 'new', 'confirm'
  const [testingMainUrl, setTestingMainUrl] = useState(false);
  const [mainUrlStatus, setMainUrlStatus] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [mintStatuses, setMintStatuses] = useState({});
  const [testingMints, setTestingMints] = useState({});
  const showStoreManagement = false; // Temporarily hide store registration UI
  // Recommended mint URLs
  const RECOMMENDED_MINTS = [
    { url: 'https://mint.coinos.io', name: 'Coinos', production: true },
    { url: 'https://mint.minibits.cash/Bitcoin', name: 'Minibits', production: true },
    { url: 'https://mint.cubabitcoin.org', name: 'CubaBitcoin', production: true },
    { url: 'https://mint.mineracks.com', name: 'MineRacks', production: true }
  ];

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  const mapMintError = useCallback((error) => {
    if (!error) {
      return t('messages.mintQuoteFailedGeneric');
    }

    if (error.name === 'AbortError') {
      return t('messages.mintQuoteTimeout');
    }

    if (error.code === 'QUOTE_HTTP_ERROR') {
      return t('messages.mintQuoteFailedStatus', { status: error.status || '???' });
    }

    if (error.code === 'QUOTE_INVALID') {
      return t('messages.mintQuoteInvalid');
    }

    if (typeof error.message === 'string' && error.message.trim().length > 0) {
      return error.message;
    }

    return t('messages.mintQuoteFailedGeneric');
  }, [t]);

  useEffect(() => {
    document.title = t('pageTitle.settings');
  }, [t, i18n.language]);

  // Load settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('app_settings');
      const defaultSettings = {
        walletName: '',
        language: 'ko',
        theme: 'light',
        currency: 'SATS',
        notifications: true,
        mintUrl: DEFAULT_MINT_URL,
        backupMintUrl: '',
        autoBackup: false,
        pinEnabled: false
      };
      if (saved) {
        const parsed = JSON.parse(saved);
        const merged = {
          ...defaultSettings,
          ...parsed,
          mintUrl: parsed.mintUrl || DEFAULT_MINT_URL,
          backupMintUrl: parsed.backupMintUrl || '',
          theme: normalizeTheme(parsed.theme || defaultSettings.theme)
        };
        setSettings(merged);
        applyTheme(merged.theme);
      } else {
        setSettings(defaultSettings);
        localStorage.setItem('app_settings', JSON.stringify(defaultSettings));
        applyTheme(defaultSettings.theme);
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
      const fallback = {
        walletName: '',
        language: 'ko',
        theme: 'light',
        currency: 'SATS',
        notifications: true,
        mintUrl: DEFAULT_MINT_URL,
        backupMintUrl: '',
        autoBackup: false,
        pinEnabled: false
      };
      setSettings(fallback);
      applyTheme(fallback.theme);
    }
  }, []);

  const saveSettings = (newSettings) => {
    try {
      localStorage.setItem('app_settings', JSON.stringify(newSettings));
    } catch (e) {
      console.error('Failed to save settings:', e);
      addToast(t('messages.settingsSaveFailed'), 'error');
    }
  };

  const handleSettingChange = (key, value) => {
    const nextValue = key === 'theme' ? normalizeTheme(value) : value;
    const newSettings = {
      ...settings,
      [key]: nextValue
    };
    setSettings(newSettings);
    saveSettings(newSettings);

    // Change language immediately when language setting changes
    if (key === 'language') {
      i18n.changeLanguage(nextValue);
    }

    if (key === 'theme') {
      applyTheme(nextValue);
    }
  };

  const openPinSetup = () => {
    if (settings.pinEnabled) {
      // Change PIN
      setPinStep('current');
    } else {
      // Set new PIN
      setPinStep('new');
    }
    setShowPinSetup(true);
    setPinInput('');
    setPinConfirm('');
    setCurrentPin('');
  };

  const handlePinSubmit = () => {
    if (pinStep === 'current') {
      // Verify current PIN
      const storedPin = localStorage.getItem('app_pin');
      if (currentPin === storedPin) {
        setPinStep('new');
        setCurrentPin('');
      } else {
        addToast(t('messages.currentPinIncorrect'), 'error');
      }
    } else if (pinStep === 'new') {
      if (pinInput.length < 4) {
        addToast(t('messages.pinMinLength'), 'error');
        return;
      }
      setPinStep('confirm');
    } else if (pinStep === 'confirm') {
      if (pinInput !== pinConfirm) {
        addToast(t('messages.pinMismatch'), 'error');
        setPinConfirm('');
        return;
      }
      // Save PIN
      localStorage.setItem('app_pin', pinInput);
      handleSettingChange('pinEnabled', true);
      setShowPinSetup(false);
      setPinInput('');
      setPinConfirm('');
      addToast(t('messages.pinSet'), 'success');
    }
  };

  const disablePin = () => {
    if (window.confirm(t('messages.confirmDisablePin'))) {
      const storedPin = localStorage.getItem('app_pin');
      const inputPin = prompt(t('messages.enterCurrentPinPrompt'));
      if (inputPin === storedPin) {
        localStorage.removeItem('app_pin');
        handleSettingChange('pinEnabled', false);
        addToast(t('messages.pinDisabled'), 'success');
      } else {
        addToast(t('messages.pinIncorrect'), 'error');
      }
    }
  };

  const testMintConnection = async (url) => {
    if (!url || !url.trim()) {
      addToast(t('messages.enterMintUrl'), 'error');
      return;
    }

    try {
      setTestingMainUrl(true);
      setMainUrlStatus(null);

      // Normalize URL
      const normalizedUrl = url.trim().replace(/\/$/, '');

      // Test connection to Mint
      const response = await fetch(`${normalizedUrl}/v1/info`);

      if (!response.ok) {
        throw new Error(t('messages.connectionFailedHttp', { status: response.status }));
      }

      const data = await response.json();

      // Verify it's a valid Cashu mint
      if (!data.name && !data.version) {
        throw new Error(t('messages.notValidMint'));
      }

      await verifyMintOperational(normalizedUrl);

      setMainUrlStatus({
        success: true,
        message: t('messages.connectionSuccessMint', { name: data.name || 'Cashu Mint' }),
        data
      });
    } catch (error) {
      console.error('Mint connection test failed:', error);
      setMainUrlStatus({
        success: false,
        message: mapMintError(error)
      });
    } finally {
      setTestingMainUrl(false);
    }
  };

  const testRecommendedMint = async (mintUrl) => {
    try {
      setTestingMints(prev => ({ ...prev, [mintUrl]: true }));

      const normalizedUrl = mintUrl.trim().replace(/\/$/, '');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      let response;
      try {
        response = await fetch(`${normalizedUrl}/v1/info`, {
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(t('messages.connectionFailedHttp', { status: response.status }));
      }

      const data = await response.json();

      if (!data.name && !data.version) {
        throw new Error(t('messages.notValidMint'));
      }

      await verifyMintOperational(normalizedUrl);

      setMintStatuses(prev => ({
        ...prev,
        [mintUrl]: { success: true, name: data.name || 'Unknown' }
      }));
    } catch (error) {
      console.error('Recommended mint test failed:', error);
      setMintStatuses(prev => ({
        ...prev,
        [mintUrl]: { success: false, error: mapMintError(error) }
      }));
    } finally {
      setTestingMints(prev => ({ ...prev, [mintUrl]: false }));
    }
  };

  // Auto-test recommended mints on mount
  useEffect(() => {
    RECOMMENDED_MINTS.forEach(mint => {
      testRecommendedMint(mint.url);
    });
  }, []);

  const handleResetWallet = () => {
    if (window.confirm(t('messages.confirmResetWallet'))) {
      if (window.confirm(t('messages.confirmBackupCheck'))) {
        try {
          // Clear all wallet data
          localStorage.removeItem('cashu_proofs');
          localStorage.removeItem('cashu_tx_v1');
          localStorage.removeItem('cashu_last_quote');
          localStorage.removeItem('cashu_last_mint_amount');
          localStorage.removeItem('cashu_redeemed_quotes');
          localStorage.removeItem('cashu_backup_dismissed');
          localStorage.removeItem('app_pin');

          const resetSettings = {
            ...settings,
            mintUrl: DEFAULT_MINT_URL,
            pinEnabled: false,
            theme: 'light'
          };

          setSettings(prev => ({
            ...prev,
            mintUrl: DEFAULT_MINT_URL,
            pinEnabled: false,
            theme: 'light'
          }));
          saveSettings(resetSettings);
          applyTheme('light');

          addToast(t('messages.walletReset'), 'success');
          setTimeout(() => window.location.reload(), 1000);
        } catch (e) {
          console.error('Reset failed:', e);
          addToast(t('messages.resetFailed'), 'error');
        }
      }
    }
  };

  return (
    <>
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>

      <div className="settings-page">
        <div className="page-header">
          <h1><Icon name="settings" size={22} /> {t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>

      <div className="settings-sections">
        {/* General Settings */}
        <div className="settings-section">
          <h2>{t('settings.general')}</h2>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">{t('settings.walletName')}</div>
              <div className="setting-description">{t('settings.walletNameDesc')}</div>
            </div>
            <input
              type="text"
              value={settings.walletName}
              onChange={(e) => handleSettingChange('walletName', e.target.value)}
              placeholder={t('settings.walletNamePlaceholder')}
              className="setting-input"
            />
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">{t('settings.language')}</div>
              <div className="setting-description">{t('settings.languageDesc')}</div>
            </div>
            <select
              value={settings.language}
              onChange={(e) => handleSettingChange('language', e.target.value)}
              className="setting-select"
            >
              <option value="ko">{t('settings.korean')}</option>
              <option value="en">{t('settings.english')}</option>
              <option value="ja">{t('settings.japanese')}</option>
            </select>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">{t('settings.theme')}</div>
              <div className="setting-description">{t('settings.themeDesc')}</div>
            </div>
            <select
              value={settings.theme || 'light'}
              onChange={(e) => handleSettingChange('theme', e.target.value)}
              className="setting-select"
            >
              <option value="light">{t('settings.light')}</option>
              <option value="dark">{t('settings.dark')}</option>
            </select>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">{t('settings.currency')}</div>
              <div className="setting-description">{t('settings.currencyDesc')}</div>
            </div>
            <select
              value={settings.currency}
              onChange={(e) => handleSettingChange('currency', e.target.value)}
              className="setting-select"
            >
              <option value="SATS">{t('settings.sats')}</option>
              <option value="BTC">{t('settings.btc')}</option>
            </select>
          </div>

        </div>

        {/* Security Settings */}
        <div className="settings-section">
          <h2>{t('settings.security')}</h2>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">{t('settings.pinLock')}</div>
              <div className="setting-description">
                {t('settings.pinLockDesc')}
              </div>
            </div>
            {!settings.pinEnabled ? (
              <button onClick={openPinSetup} className="setting-button">
                {t('settings.setupPin')}
              </button>
            ) : (
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button onClick={openPinSetup} className="setting-button">
                  {t('settings.changePin')}
                </button>
                <button onClick={disablePin} className="danger-button">
                  {t('settings.disablePin')}
                </button>
              </div>
            )}
          </div>
        </div>



        {/* Cashu Mint Settings */}
        <div className="settings-section">
          <h2>{t('settings.mintSettings')}</h2>

          <div className="setting-item">
            <div className="setting-info" style={{ flex: 1 }}>
              <div className="setting-title">{t('settings.mintUrl')}</div>
              <div className="setting-description">
                {t('settings.mintUrlDesc')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input
                  type="url"
                  placeholder={DEFAULT_MINT_URL}
                  value={settings.mintUrl}
                  onChange={(e) => {
                    handleSettingChange('mintUrl', e.target.value);
                    setMainUrlStatus(null);
                  }}
                  className="setting-input"
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => testMintConnection(settings.mintUrl)}
                  className="icon-btn"
                  disabled={testingMainUrl || !settings.mintUrl}
                  title={testingMainUrl ? t('settings.testing') : t('settings.testConnection')}
                >
                  {testingMainUrl ? (
                    <Icon name="loader" size={20} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <Icon name="check-circle" size={20} />
                  )}
                </button>
              </div>

              {/* Recommended Mints */}
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: 'var(--muted)' }}>
                  {t('settings.recommendedMints')}:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {RECOMMENDED_MINTS.map((mint) => {
                    const status = mintStatuses[mint.url];
                    const isTesting = testingMints[mint.url];
                    const isSelected = settings.mintUrl === mint.url;

                    return (
                      <button
                        key={mint.url}
                        onClick={() => {
                          handleSettingChange('mintUrl', mint.url);
                          setMainUrlStatus(null);
                        }}
                        className="mint-suggestion-btn"
                        style={{
                          padding: '0.625rem 0.875rem',
                          fontSize: '0.8125rem',
                          background: isSelected ? 'rgba(var(--primary-rgb), 0.15)' : 'var(--surface-bg)',
                          border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                          borderRadius: '0.5rem',
                          color: isSelected ? 'var(--primary)' : 'var(--text)',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          textAlign: 'left',
                          gap: '0.75rem'
                        }}
                      >
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '500' }}>
                            <span>{mint.name}</span>
                            {!mint.production && (
                              <span style={{
                                fontSize: '0.6875rem',
                                padding: '0.125rem 0.375rem',
                                background: 'rgba(251, 191, 36, 0.15)',
                                color: '#f59e0b',
                                borderRadius: '0.25rem',
                                fontWeight: '600'
                              }}>
                                TEST
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                            {mint.url.replace('https://', '')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {isTesting ? (
                            <div style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: '#94a3b8',
                              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                            }} />
                          ) : status ? (
                            <div
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: status.success ? '#22c55e' : '#ef4444',
                                boxShadow: status.success
                                  ? '0 0 8px rgba(34, 197, 94, 0.5)'
                                  : '0 0 8px rgba(239, 68, 68, 0.5)'
                              }}
                              title={status.success ? `Connected: ${status.name}` : `Error: ${status.error}`}
                            />
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {mainUrlStatus && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem',
                  borderRadius: '6px',
                  fontSize: '13px',
                  backgroundColor: mainUrlStatus.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  color: mainUrlStatus.success ? 'var(--success)' : 'var(--danger)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <Icon name={mainUrlStatus.success ? 'check' : 'close'} size={14} />
                  <span>{mainUrlStatus.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Store Management */}
        {showStoreManagement && (
          <div className="settings-section">
            <h2>{t('settings.storeManagement')}</h2>

            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-title">{t('settings.registerStore')}</div>
                <div className="setting-description">
                  {t('settings.registerStoreDesc')}
                </div>
              </div>
              <button
                onClick={() => navigate('/settings/add-store')}
                className="setting-button"
              >
                {t('settings.addStore')}
              </button>
            </div>
          </div>
        )}

        {/* Danger Zone */}
        <div className="settings-section danger-section">
          <h2>{t('settings.dangerZone')}</h2>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">{t('settings.resetWallet')}</div>
              <div className="setting-description">
                {t('settings.resetWalletDesc')}
              </div>
            </div>
            <button
              onClick={handleResetWallet}
              className="danger-button"
            >
              {t('settings.resetWalletButton')}
            </button>
          </div>
        </div>
      </div>

      {/* PIN Setup Modal */}
      {showPinSetup && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{settings.pinEnabled ? t('settings.pinChange') : t('settings.pinSetup')}</h3>
              <button onClick={() => setShowPinSetup(false)} aria-label={t('common.close')}>
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="modal-body">
              {pinStep === 'current' && (
                <div className="input-group">
                  <label>{t('settings.currentPin')}</label>
                  <input
                    type="password"
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value)}
                    placeholder={t('settings.enterCurrentPin')}
                    maxLength="6"
                  />
                </div>
              )}
              {pinStep === 'new' && (
                <div className="input-group">
                  <label>{t('settings.newPin')}</label>
                  <input
                    type="password"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder={t('settings.enterNewPin')}
                    maxLength="6"
                  />
                  <small>{t('settings.pinHint')}</small>
                </div>
              )}
              {pinStep === 'confirm' && (
                <div className="input-group">
                  <label>{t('settings.confirmPin')}</label>
                  <input
                    type="password"
                    value={pinConfirm}
                    onChange={(e) => setPinConfirm(e.target.value)}
                    placeholder={t('settings.reenterPin')}
                    maxLength="6"
                  />
                </div>
              )}
              <div className="modal-actions">
                <button className="primary-btn" onClick={handlePinSubmit}>
                  {pinStep === 'confirm' ? t('settings.done') : t('common.next')}
                </button>
                <button className="secondary-btn" onClick={() => setShowPinSetup(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}

export default Settings;
