import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './PaymentSuccess.css';

function PaymentSuccess() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { amount, returnTo, type } = location.state || {};

  // type: 'receive' or 'send'
  const isReceive = type === 'receive' || returnTo === '/wallet/receive';

  const formatAmount = (sats) => {
    const localeMap = {
      ko: 'ko-KR',
      en: 'en-US',
      ja: 'ja-JP'
    };
    const locale = localeMap[i18n.language] || 'en-US';
    return new Intl.NumberFormat(locale).format(sats);
  };

  const handleConfirm = () => {
    // If coming from receive/send page, go to wallet
    // Otherwise, go back to the original page
    if (returnTo === '/wallet/receive' || returnTo === '/wallet/send') {
      navigate('/wallet');
    } else if (returnTo) {
      navigate(returnTo);
    } else {
      navigate('/wallet');
    }
  };

  return (
    <div className="payment-success-overlay">
      <div className="payment-success-modal">
        <div className="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>

        <h2 className="success-title">
          {isReceive ? t('paymentSuccess.receiveComplete') : t('paymentSuccess.sendComplete')}
        </h2>

        <p className="success-amount">
          {formatAmount(amount || 0)} <span className="amount-unit">sats</span>
        </p>

        <p className="success-message">
          {isReceive
            ? t('paymentSuccess.receiveMessage')
            : t('paymentSuccess.sendMessage')}
        </p>

        <button onClick={handleConfirm} className="confirm-btn">
          {t('common.confirm')}
        </button>
      </div>
    </div>
  );
}

export default PaymentSuccess;
