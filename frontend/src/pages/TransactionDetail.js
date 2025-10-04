import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import './TransactionDetail.css';

function TransactionDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const transaction = location.state?.transaction;

  if (!transaction) {
    return (
      <div className="transaction-detail-page">
        <div className="detail-error">
          <p>거래 정보를 찾을 수 없습니다</p>
          <button onClick={() => navigate('/wallet')} className="back-btn">
            지갑으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const formatAmount = (sats) => {
    return new Intl.NumberFormat('ko-KR').format(sats);
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return {
      date: date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      }),
      time: date.toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    };
  };

  const getTypeInfo = (type) => {
    switch (type) {
      case 'receive':
        return { icon: 'inbox', label: '수신', color: '#10b981' };
      case 'send':
        return { icon: 'send', label: '송신', color: '#f59e0b' };
      case 'convert':
        return { icon: 'repeat', label: '전환', color: '#6366f1' };
      default:
        return { icon: 'info', label: '기타', color: '#6b7280' };
    }
  };

  const typeInfo = getTypeInfo(transaction.type);
  const dateInfo = formatDate(transaction.timestamp);

  return (
    <div className="transaction-detail-page">
      <div className="detail-header">
        <button onClick={() => navigate('/wallet')} className="back-button">
          <Icon name="arrow-left" size={20} />
          <span>거래 내역</span>
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
              <span>거래 유형</span>
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
              <span>상태</span>
            </div>
            <div className="info-value">
              <span className={`status-badge ${transaction.status}`}>
                {transaction.status === 'confirmed' ? '완료' : transaction.status === 'pending' ? '대기 중' : '실패'}
              </span>
            </div>
          </div>

          <div className="info-row">
            <div className="info-label">
              <Icon name="calendar" size={18} />
              <span>날짜</span>
            </div>
            <div className="info-value">{dateInfo.date}</div>
          </div>

          <div className="info-row">
            <div className="info-label">
              <Icon name="clock" size={18} />
              <span>시간</span>
            </div>
            <div className="info-value">{dateInfo.time}</div>
          </div>

          <div className="info-row">
            <div className="info-label">
              <Icon name="hash" size={18} />
              <span>거래 ID</span>
            </div>
            <div className="info-value monospace">{transaction.id}</div>
          </div>

          {transaction.actualAmount && (
            <>
              <div className="info-row">
                <div className="info-label">
                  <Icon name="diamond" size={18} />
                  <span>실제 전환 금액</span>
                </div>
                <div className="info-value">{formatAmount(transaction.actualAmount)} sats</div>
              </div>

              <div className="info-row">
                <div className="info-label">
                  <Icon name="zap" size={18} />
                  <span>수수료</span>
                </div>
                <div className="info-value">{formatAmount(transaction.fee)} sats</div>
              </div>
            </>
          )}

          {transaction.quote && (
            <div className="info-row">
              <div className="info-label">
                <Icon name="file-text" size={18} />
                <span>Quote ID</span>
              </div>
              <div className="info-value monospace">{transaction.quote}</div>
            </div>
          )}

          <div className="info-row">
            <div className="info-label">
              <Icon name="database" size={18} />
              <span>타임스탬프</span>
            </div>
            <div className="info-value monospace">{new Date(transaction.timestamp).getTime()}</div>
          </div>
        </div>

        <div className="detail-actions">
          <button onClick={() => navigate('/wallet')} className="primary-action-btn">
            지갑으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  );
}

export default TransactionDetail;
