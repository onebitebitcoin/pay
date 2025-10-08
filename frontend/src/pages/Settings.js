import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DEFAULT_MINT_URL } from '../config';
import './Settings.css';
import Icon from '../components/Icon';

function Settings() {
  const { t, i18n } = useTranslation();
  // Removed WebSocket functionality - using polling instead
  const navigate = useNavigate();
  const [settings, setSettings] = useState({
    walletName: '',
    language: 'ko',
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
  const [wsDebugLogs, setWsDebugLogs] = useState([]);
  const [testMessage, setTestMessage] = useState('{"type":"ping","timestamp":' + Date.now() + '}');

  // Recommended mint URLs
  const RECOMMENDED_MINTS = [
    'https://mint.cubabitcoin.org',
    'https://mint.minibits.cash/Bitcoin',
    'https://mint.coinos.io',
    'https://mint.lnvoltz.com'
  ];

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

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
          backupMintUrl: parsed.backupMintUrl || ''
        };
        setSettings(merged);
      } else {
        setSettings(defaultSettings);
        localStorage.setItem('app_settings', JSON.stringify(defaultSettings));
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
      const fallback = {
        walletName: '',
        language: 'ko',
        currency: 'SATS',
        notifications: true,
        mintUrl: DEFAULT_MINT_URL,
        backupMintUrl: '',
        autoBackup: false,
        pinEnabled: false
      };
      setSettings(fallback);
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
    const newSettings = {
      ...settings,
      [key]: value
    };
    setSettings(newSettings);
    saveSettings(newSettings);

    // Change language immediately when language setting changes
    if (key === 'language') {
      i18n.changeLanguage(value);
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

      setMainUrlStatus({
        success: true,
        message: t('messages.connectionSuccessMint', { name: data.name || 'Cashu Mint' }),
        data
      });
    } catch (error) {
      console.error('Mint connection test failed:', error);
      setMainUrlStatus({
        success: false,
        message: error.message || t('messages.connectionFailedGeneric')
      });
    } finally {
      setTestingMainUrl(false);
    }
  };

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

          setSettings(prev => ({
            ...prev,
            mintUrl: DEFAULT_MINT_URL,
            pinEnabled: false
          }));
          saveSettings({
            ...settings,
            mintUrl: DEFAULT_MINT_URL,
            pinEnabled: false
          });

          addToast(t('messages.walletReset'), 'success');
          setTimeout(() => window.location.reload(), 1000);
        } catch (e) {
          console.error('Reset failed:', e);
          addToast(t('messages.resetFailed'), 'error');
        }
      }
    }
  };

  // Removed WebSocket functionality - using polling instead


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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {RECOMMENDED_MINTS.map((mintUrl) => (
                    <button
                      key={mintUrl}
                      onClick={() => {
                        handleSettingChange('mintUrl', mintUrl);
                        setMainUrlStatus(null);
                      }}
                      className="mint-suggestion-btn"
                      style={{
                        padding: '0.375rem 0.75rem',
                        fontSize: '0.8125rem',
                        background: settings.mintUrl === mintUrl ? 'rgba(var(--primary-rgb), 0.15)' : 'var(--surface-bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '0.375rem',
                        color: settings.mintUrl === mintUrl ? 'var(--primary)' : 'var(--text)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {mintUrl.replace('https://', '')}
                    </button>
                  ))}
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
