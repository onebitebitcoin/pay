import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './Home.css';
import Icon from '../components/Icon';

function Home() {
  const { t } = useTranslation();

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-content">
          <h1 className="hero-title">
            <span className="bitcoin-icon"><Icon name="bitcoin" size={64} /></span>
            {t('home.title')}
          </h1>
          <p className="hero-subtitle">
            {t('home.subtitle')}
          </p>

          <div className="feature-cards">
            <Link to="/map" className="feature-card">
              <div className="feature-icon"><Icon name="map" size={48} /></div>
              <h3>{t('home.findStore')}</h3>
              <p>{t('home.findStoreDesc')}</p>
            </Link>

            <Link to="/wallet" className="feature-card">
              <div className="feature-icon"><Icon name="shield" size={48} /></div>
              <h3>{t('home.cashuWallet')}</h3>
              <p>{t('home.cashuWalletDesc')}</p>
            </Link>
          </div>
        </div>
      </div>

      <div className="stats-section">
        <div className="stats-container">
          <div className="stat-item">
            <div className="stat-number">15</div>
            <div className="stat-label">{t('home.bitcoinStoresCount')}</div>
          </div>
          <div className="stat-item">
            <div className="stat-number">50K+</div>
            <div className="stat-label">{t('home.totalVolume')}</div>
          </div>
          <div className="stat-item">
            <div className="stat-number">100%</div>
            <div className="stat-label">{t('home.privacyProtection')}</div>
          </div>
        </div>
      </div>

      <div className="info-section">
        <div className="info-content">
          <h2>{t('home.whyBitcoin')}</h2>
          <div className="info-grid">
            <div className="info-item">
              <div className="info-icon"><Icon name="lock" size={48} /></div>
              <h4>{t('home.privacy')}</h4>
              <p>{t('home.privacyDesc')}</p>
            </div>
            <div className="info-item">
              <div className="info-icon"><Icon name="bolt" size={48} /></div>
              <h4>{t('home.instantPayment')}</h4>
              <p>{t('home.instantPaymentDesc')}</p>
            </div>
            <div className="info-item">
              <div className="info-icon"><Icon name="globe" size={48} /></div>
              <h4>{t('home.global')}</h4>
              <p>{t('home.globalDesc')}</p>
            </div>
            <div className="info-item">
              <div className="info-icon"><Icon name="diamond" size={48} /></div>
              <h4>{t('home.digitalGold')}</h4>
              <p>{t('home.digitalGoldDesc')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;
