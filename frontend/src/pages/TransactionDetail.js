import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../components/Icon';
import './TransactionDetail.css';

function TransactionDetail() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const transaction = location.state?.transaction;

  if (!transaction) {
    return (
      <div className="transaction-detail-page">
        <div className="detail-error">
          <p>{t('transaction.notFound')}</p>
          <button onClick={() => navigate('/wallet')} className="back-btn">
            {t('wallet.backToWallet')}
          </button>
        </div>
      </div>
    );
  }

  const formatAmount = (sats) => {
    const locale = i18n.language === 'ko' ? 'ko-KR' : i18n.language === 'ja' ? 'ja-JP' : 'en-US';
    return new Intl.NumberFormat(locale).format(sats);
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const locale = i18n.language === 'ko' ? 'ko-KR' : i18n.language === 'ja' ? 'ja-JP' : 'en-US';
    return {
      date: date.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      }),
      time: date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    };
  };

  const getTypeInfo = (type) => {
    switch (type) {
      case 'receive':
        return { icon: 'inbox', label: t('transaction.typeReceive'), color: '#10b981' };
      case 'send':
        return { icon: 'send', label: t('transaction.typeSend'), color: '#f59e0b' };
      case 'convert':
        return { icon: 'repeat', label: t('transaction.typeConvert'), color: '#6366f1' };
      default:
        return { icon: 'info', label: t('transaction.typeOther'), color: '#6b7280' };
    }
  };

  const typeInfo = getTypeInfo(transaction.type);
  const dateInfo = formatDate(transaction.timestamp);

  return (
    <div className="transaction-detail-page">
      <div className="detail-header">
        <button onClick={() => navigate('/wallet')} className="back-button">
          <Icon name="arrow-left" size={20} />
          <span>{t('transaction.detail')}</span>
        </button>
      </div>

      <div className="detail-card">
        <div className="detail-hero">
          <div className="detail-icon" style={{ backgroundColor: `${typeInfo.color}15` }}>
            <Icon name={typeInfo.icon} size={40} color={typeInfo.color} />
          </div>
          <h1 className={`detail-amount ${transaction.amount > 0 ? 'positive' : 'negative'}`}>
            {transaction.amount > 0 ? '+' : ''}{formatAmount(Math.abs(transaction.amount))}
            <span className="amount-unit">sats</span>
          </h1>
          <p className="detail-description">{transaction.description}</p>
        </div>

        <div className="detail-divider"></div>

        <div className="detail-info-grid">
          <div className="info-row">
            <div className="info-label">
              <Icon name="info" size={18} />
              <span>{t('transaction.type')}</span>
            </div>
            <div className="info-value">
              <span className="type-badge" style={{ backgroundColor: `${typeInfo.color}15`, color: typeInfo.color }}>
                {typeInfo.label}
              </span>
            </div>
          </div>

          <div className="info-row">
            <div className="info-label">
              <Icon name="check-circle" size={18} />
              <span>{t('transaction.status')}</span>
            </div>
            <div className="info-value">
              <span className={`status-badge ${transaction.status}`}>
                {transaction.status === 'confirmed' ? t('messages.statusConfirmed') : transaction.status === 'pending' ? t('messages.statusPending') : t('transaction.statusFailed')}
              </span>
            </div>
          </div>

          <div className="info-row">
            <div className="info-label">
              <Icon name="calendar" size={18} />
              <span>{t('transaction.date')}</span>
            </div>
            <div className="info-value">{dateInfo.date}</div>
          </div>

          <div className="info-row">
            <div className="info-label">
              <Icon name="clock" size={18} />
              <span>{t('transaction.time')}</span>
            </div>
            <div className="info-value">{dateInfo.time}</div>
          </div>

          <div className="info-row">
            <div className="info-label">
              <Icon name="hash" size={18} />
              <span>{t('transaction.id')}</span>
            </div>
            <div className="info-value monospace">{transaction.id}</div>
          </div>

          {transaction.actualAmount && (
            <>
              <div className="info-row">
                <div className="info-label">
                  <Icon name="diamond" size={18} />
                  <span>{t('transaction.actualAmount')}</span>
                </div>
                <div className="info-value">{formatAmount(transaction.actualAmount)} sats</div>
              </div>

              <div className="info-row">
                <div className="info-label">
                  <Icon name="zap" size={18} />
                  <span>{t('wallet.fee')}</span>
                </div>
                <div className="info-value">{formatAmount(transaction.fee)} sats</div>
              </div>
            </>
          )}

          {transaction.quote && (
            <div className="info-row">
              <div className="info-label">
                <Icon name="file-text" size={18} />
                <span>{t('transaction.quoteId')}</span>
              </div>
              <div className="info-value monospace">{transaction.quote}</div>
            </div>
          )}

          <div className="info-row">
            <div className="info-label">
              <Icon name="database" size={18} />
              <span>{t('transaction.timestamp')}</span>
            </div>
            <div className="info-value monospace">{new Date(transaction.timestamp).getTime()}</div>
          </div>
        </div>

        <div className="detail-actions">
          <button onClick={() => navigate('/wallet')} className="primary-action-btn">
            {t('wallet.backToWallet')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TransactionDetail;
