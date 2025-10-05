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


  // PIN Lock Screen
  if (pinLocked) {
    return (
      <div className="pin-lock-overlay">
        <div className="pin-lock-container">
          <div className="pin-lock-content">
            <div className="pin-lock-icon">
              <Icon name="shield" size={64} />
            </div>
            <h2>한입만</h2>
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
              한입만
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
    </div>
  );
};

export default Layout;
