import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import './InstallPrompt.css';

function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Check if user has already dismissed the prompt
    const dismissed = localStorage.getItem('pwa_install_dismissed');
    if (dismissed) {
      return;
    }

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show prompt after 3 seconds
      setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    console.log(`User response: ${outcome}`);
    setDeferredPrompt(null);
    setShowPrompt(false);

    // Don't show again regardless of outcome
    localStorage.setItem('pwa_install_dismissed', 'true');
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa_install_dismissed', 'true');
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <div className="install-prompt-overlay">
      <div className="install-prompt">
        <button className="install-close" onClick={handleDismiss} aria-label="닫기">
          <Icon name="close" size={20} />
        </button>

        <div className="install-icon">
          <img src="/logo-192.png" alt="한입 비트코인" />
        </div>

        <h2>앱으로 다운받기</h2>
        <p>홈 화면에 추가하고 더 빠르게 접속하세요!</p>

        <div className="install-features">
          <div className="install-feature">
            <Icon name="bolt" size={18} />
            <span>빠른 실행</span>
          </div>
          <div className="install-feature">
            <Icon name="shield" size={18} />
            <span>오프라인 지원</span>
          </div>
          <div className="install-feature">
            <Icon name="diamond" size={18} />
            <span>앱처럼 사용</span>
          </div>
        </div>

        <button className="install-button" onClick={handleInstall}>
          지금 설치하기
        </button>
        <button className="install-later" onClick={handleDismiss}>
          나중에
        </button>
      </div>
    </div>
  );
}

export default InstallPrompt;
