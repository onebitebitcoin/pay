import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_MINT_URL } from '../config';
import './Settings.css';
import Icon from '../components/Icon';

function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState({
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

  // Load settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('app_settings');
      const defaultSettings = {
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
      alert('설정 저장에 실패했습니다.');
    }
  };

  const handleSettingChange = (key, value) => {
    const newSettings = {
      ...settings,
      [key]: value
    };
    setSettings(newSettings);
    saveSettings(newSettings);
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
        alert('현재 PIN이 올바르지 않습니다.');
      }
    } else if (pinStep === 'new') {
      if (pinInput.length < 4) {
        alert('PIN은 최소 4자리 이상이어야 합니다.');
        return;
      }
      setPinStep('confirm');
    } else if (pinStep === 'confirm') {
      if (pinInput !== pinConfirm) {
        alert('PIN이 일치하지 않습니다.');
        setPinConfirm('');
        return;
      }
      // Save PIN
      localStorage.setItem('app_pin', pinInput);
      handleSettingChange('pinEnabled', true);
      setShowPinSetup(false);
      setPinInput('');
      setPinConfirm('');
      alert('PIN이 설정되었습니다.');
    }
  };

  const disablePin = () => {
    if (window.confirm('PIN 잠금을 해제하시겠습니까?')) {
      const storedPin = localStorage.getItem('app_pin');
      const inputPin = prompt('현재 PIN을 입력하세요:');
      if (inputPin === storedPin) {
        localStorage.removeItem('app_pin');
        handleSettingChange('pinEnabled', false);
        alert('PIN 잠금이 해제되었습니다.');
      } else {
        alert('PIN이 올바르지 않습니다.');
      }
    }
  };

  const testMintConnection = async (url) => {
    if (!url || !url.trim()) {
      alert('URL을 입력해주세요');
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
        throw new Error(`HTTP ${response.status}: 연결 실패`);
      }

      const data = await response.json();

      // Verify it's a valid Cashu mint
      if (!data.name && !data.version) {
        throw new Error('유효한 Cashu Mint가 아닙니다');
      }

      setMainUrlStatus({
        success: true,
        message: `연결 성공 (${data.name || 'Cashu Mint'})`,
        data
      });
    } catch (error) {
      console.error('Mint connection test failed:', error);
      setMainUrlStatus({
        success: false,
        message: error.message || '연결 실패'
      });
    } finally {
      setTestingMainUrl(false);
    }
  };

  const handleResetWallet = () => {
    if (window.confirm('정말로 지갑을 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      if (window.confirm('모든 데이터가 삭제됩니다. 백업을 확인하셨나요?')) {
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

          alert('지갑이 초기화되었습니다. 페이지를 새로고침합니다.');
          window.location.reload();
        } catch (e) {
          console.error('Reset failed:', e);
          alert('초기화 중 오류가 발생했습니다.');
        }
      }
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1><Icon name="settings" size={22} /> 설정</h1>
        <p>앱 설정을 관리하세요</p>
      </div>

      <div className="settings-sections">
        {/* General Settings */}
        <div className="settings-section">
          <h2>일반 설정</h2>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">언어</div>
              <div className="setting-description">앱 인터페이스 언어 (향후 지원 예정)</div>
            </div>
            <select
              value={settings.language}
              onChange={(e) => handleSettingChange('language', e.target.value)}
              className="setting-select"
            >
              <option value="ko">한국어</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">기본 단위</div>
              <div className="setting-description">금액 표시 단위 (sats 권장)</div>
            </div>
            <select
              value={settings.currency}
              onChange={(e) => handleSettingChange('currency', e.target.value)}
              className="setting-select"
            >
              <option value="SATS">사토시 (sats)</option>
              <option value="BTC">비트코인 (BTC)</option>
            </select>
          </div>

        </div>

        {/* Security Settings */}
        <div className="settings-section">
          <h2>보안 설정</h2>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">PIN 잠금</div>
              <div className="setting-description">
                앱 실행 시 PIN 번호 요구 (권장)
              </div>
            </div>
            {!settings.pinEnabled ? (
              <button onClick={openPinSetup} className="setting-button">
                PIN 설정
              </button>
            ) : (
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button onClick={openPinSetup} className="setting-button">
                  PIN 변경
                </button>
                <button onClick={disablePin} className="danger-button">
                  해제
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Cashu Mint Settings */}
        <div className="settings-section">
          <h2>Cashu Mint 설정</h2>

          <div className="setting-item">
            <div className="setting-info" style={{ flex: 1 }}>
              <div className="setting-title">Mint URL</div>
              <div className="setting-description">
                사용할 Cashu Mint 서버 (변경 후 페이지 새로고침 필요)
              </div>
              <input
                type="url"
                placeholder={DEFAULT_MINT_URL}
                value={settings.mintUrl}
                onChange={(e) => {
                  handleSettingChange('mintUrl', e.target.value);
                  setMainUrlStatus(null);
                }}
                className="setting-input"
                style={{ marginTop: '0.5rem', width: '100%' }}
              />
              {mainUrlStatus && (
                <div style={{
                  marginTop: '0.5rem',
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
            <button
              onClick={() => testMintConnection(settings.mintUrl)}
              className="icon-btn"
              disabled={testingMainUrl || !settings.mintUrl}
              title={testingMainUrl ? '테스트 중...' : '연결 테스트'}
              style={{ alignSelf: 'flex-start' }}
            >
              {testingMainUrl ? (
                <Icon name="refresh" size={20} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Icon name={mainUrlStatus?.success ? 'check' : 'shield'} size={20} />
              )}
            </button>
          </div>
        </div>

        {/* Store Management */}
        <div className="settings-section">
          <h2>매장 관리</h2>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">비트코인 결제 가능 매장 등록</div>
              <div className="setting-description">
                비트코인/라이트닝 결제를 받는 매장을 지도에 등록할 수 있습니다
              </div>
            </div>
            <button
              onClick={() => navigate('/settings/add-store')}
              className="setting-button"
            >
              매장 등록하기
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="settings-section danger-section">
          <h2>위험 구역</h2>

          <div className="setting-item">
            <div className="setting-info">
              <div className="setting-title">지갑 초기화</div>
              <div className="setting-description">
                모든 지갑 데이터를 삭제하고 처음부터 시작합니다.
                <strong> 이 작업은 되돌릴 수 없습니다.</strong>
              </div>
            </div>
            <button
              onClick={handleResetWallet}
              className="danger-button"
            >
              지갑 초기화
            </button>
          </div>
        </div>
      </div>

      {/* PIN Setup Modal */}
      {showPinSetup && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>PIN {settings.pinEnabled ? '변경' : '설정'}</h3>
              <button onClick={() => setShowPinSetup(false)} aria-label="닫기">
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="modal-body">
              {pinStep === 'current' && (
                <div className="input-group">
                  <label>현재 PIN</label>
                  <input
                    type="password"
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value)}
                    placeholder="현재 PIN을 입력하세요"
                    maxLength="6"
                  />
                </div>
              )}
              {pinStep === 'new' && (
                <div className="input-group">
                  <label>새 PIN (4-6자리)</label>
                  <input
                    type="password"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="새 PIN을 입력하세요"
                    maxLength="6"
                  />
                  <small>숫자 4-6자리를 입력하세요</small>
                </div>
              )}
              {pinStep === 'confirm' && (
                <div className="input-group">
                  <label>PIN 확인</label>
                  <input
                    type="password"
                    value={pinConfirm}
                    onChange={(e) => setPinConfirm(e.target.value)}
                    placeholder="PIN을 다시 입력하세요"
                    maxLength="6"
                  />
                </div>
              )}
              <div className="modal-actions">
                <button className="primary-btn" onClick={handlePinSubmit}>
                  {pinStep === 'confirm' ? '완료' : '다음'}
                </button>
                <button className="secondary-btn" onClick={() => setShowPinSetup(false)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
