import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Layout.css';
import Icon from './Icon';

const Layout = ({ children }) => {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const [pinLocked, setPinLocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const navigation = [
    { name: '지갑', path: '/', icon: 'bitcoin' },
    { name: '매장 찾기', path: '/map', icon: 'map' },
    { name: 'FAQ', path: '/about', icon: 'info' },
    { name: '설정', path: '/settings', icon: 'settings' }
  ];

  // Check PIN lock on mount
  useEffect(() => {
    try {
      const settings = localStorage.getItem('app_settings');
      if (settings) {
        const parsed = JSON.parse(settings);
        if (parsed.pinEnabled) {
          const storedPin = localStorage.getItem('app_pin');
          if (storedPin) {
            setPinLocked(true);
          }
        }
      }
    } catch (e) {
      console.error('Failed to check PIN lock:', e);
    }
  }, []);

  const handlePinSubmit = (e) => {
    e?.preventDefault();
    try {
      const storedPin = localStorage.getItem('app_pin');
      if (pinInput === storedPin) {
        setPinLocked(false);
        setPinInput('');
        setPinError('');
      } else {
        setPinError('PIN이 올바르지 않습니다');
        setPinInput('');
      }
    } catch (e) {
      setPinError('오류가 발생했습니다');
    }
  };

  // A2HS (Add to Home Screen) banner
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  useEffect(() => {
    const dismissed = localStorage.getItem('a2hs_dismissed') === '1';
    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!dismissed && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        setShowInstall(true);
      }
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const installBanner = showInstall ? (
    <div className="install-banner">
      <span>한입 결제를 홈 화면에 추가해 빠르게 실행해보세요.</span>
      <div className="actions">
        <button
          onClick={async () => {
            try {
              if (!deferredPrompt) return setShowInstall(false);
              deferredPrompt.prompt();
              const { outcome } = await deferredPrompt.userChoice;
              if (outcome !== 'accepted') {
                // keep banner hidden once dismissed
                localStorage.setItem('a2hs_dismissed', '1');
              }
            } catch {}
            setShowInstall(false);
          }}
        >설치</button>
        <button className="dismiss" onClick={() => { localStorage.setItem('a2hs_dismissed','1'); setShowInstall(false); }}>닫기</button>
      </div>
    </div>
  ) : null;

  // PIN Lock Screen
  if (pinLocked) {
    return (
      <div className="pin-lock-overlay">
        <div className="pin-lock-container">
          <div className="pin-lock-content">
            <div className="pin-lock-icon">
              <Icon name="shield" size={64} />
            </div>
            <h2>한입 결제</h2>
            <p>앱을 사용하려면 PIN을 입력하세요</p>
            <form onSubmit={handlePinSubmit}>
              <div className="pin-input-group">
                <input
                  type="password"
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError('');
                  }}
                  placeholder="PIN 입력"
                  maxLength="6"
                  autoFocus
                  className={pinError ? 'error' : ''}
                />
              </div>
              {pinError && (
                <div className="pin-error">{pinError}</div>
              )}
              <button
                type="submit"
                className="pin-submit-btn"
                disabled={!pinInput}
              >
                잠금 해제
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="brand">
            <h1 className="header-title">
              <img src="/logo-192.png" alt="한입 로고" className="header-logo" />
              한입 결제
            </h1>
          </div>
          <nav className="topnav">
            {navigation.map((item) => {
              const isWalletPath = item.path === '/';
              const active = isWalletPath
                ? location.pathname === '/' || location.pathname.startsWith('/wallet')
                : location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`topnav-link ${active ? 'active' : ''}`}
                >
                <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
                <span className="nav-text">{item.name}</span>
                </Link>
              );
            })}
          </nav>
          <button
            className="topnav-toggle"
            aria-label="메뉴 열기"
            onClick={() => setNavOpen((v) => !v)}
          >
            <Icon name="menu" size={22} />
          </button>
        </div>
      </header>
      {navOpen && (
        <div className="topnav-drawer">
          {navigation.map((item) => {
            const isWalletPath = item.path === '/';
            const active = isWalletPath
              ? location.pathname === '/' || location.pathname.startsWith('/wallet')
              : location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`topnav-drawer-link ${active ? 'active' : ''}`}
                onClick={() => setNavOpen(false)}
              >
              <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
              <span className="nav-text">{item.name}</span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="below-header">
        {/* Main Content */}
        <main className="main-content">
          {children}
        </main>
      </div>

      {/* Install banner (A2HS) */}
      {installBanner}
    </div>
  );
};

export default Layout;
