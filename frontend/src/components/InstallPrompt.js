import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';
import './InstallPrompt.css';

function InstallPrompt() {
  const { t } = useTranslation();
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
        <button className="install-close" onClick={handleDismiss} aria-label={t('common.close')}>
          <Icon name="close" size={20} />
        </button>

        <div className="install-icon">
          <img src="/logo-192.png" alt={t('wallet.title')} />
        </div>

        <h2>{t('install.title')}</h2>
        <p>{t('install.subtitle')}</p>

        <div className="install-features">
          <div className="install-feature">
            <Icon name="bolt" size={18} />
            <span>{t('install.fastLaunch')}</span>
          </div>
          <div className="install-feature">
            <Icon name="shield" size={18} />
            <span>{t('install.offlineSupport')}</span>
          </div>
          <div className="install-feature">
            <Icon name="diamond" size={18} />
            <span>{t('install.appLike')}</span>
          </div>
        </div>

        <button className="install-button" onClick={handleInstall}>
          {t('install.installNow')}
        </button>
        <button className="install-later" onClick={handleDismiss}>
          {t('install.later')}
        </button>
      </div>
    </div>
  );
}

export default InstallPrompt;
