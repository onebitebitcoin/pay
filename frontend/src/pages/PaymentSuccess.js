import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './PaymentSuccess.css';

function PaymentSuccess() {
  const location = useLocation();
  const navigate = useNavigate();
  const { amount, returnTo } = location.state || {};

  const formatAmount = (sats) => {
    return new Intl.NumberFormat('ko-KR').format(sats);
  };

  const handleConfirm = () => {
    // If coming from receive page, go to wallet
    // Otherwise, go back to the original page
    if (returnTo === '/wallet/receive') {
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
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>

        <h2 className="success-title">결제 완료!</h2>

        <p className="success-amount">
          {formatAmount(amount || 0)} <span className="amount-unit">sats</span>
        </p>

        <p className="success-message">라이트닝 결제를 성공적으로 받았습니다!</p>

        <button onClick={handleConfirm} className="confirm-btn">
          확인
        </button>
      </div>
    </div>
  );
}

export default PaymentSuccess;
