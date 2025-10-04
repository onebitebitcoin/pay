import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import About from './pages/About';
import StoreFinder from './pages/StoreFinder';
import Wallet from './pages/Wallet';
import Settings from './pages/Settings';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext';
// Removed legacy global styles to prevent CSS conflicts

function AppContent() {
  const { subscribe } = useWebSocket();
  const [paymentNotification, setPaymentNotification] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState(null);

  useEffect(() => {
    // Subscribe to WebSocket messages
    const unsubscribe = subscribe('app-payment-listener', (message) => {
      if (message.type === 'payment_received') {
        console.log('Payment received notification:', message);

        // Show notification toast
        setPaymentNotification({
          amount: message.amount,
          timestamp: message.timestamp
        });

        // Show modal
        setPaymentDetails({
          amount: message.amount,
          timestamp: message.timestamp
        });
        setShowPaymentModal(true);

        // Dispatch custom event so Wallet component can update balance
        window.dispatchEvent(new CustomEvent('payment_received', {
          detail: {
            amount: message.amount,
            quote: message.quote,
            timestamp: message.timestamp,
            signatures: message.signatures,
            keysetId: message.keysetId
          }
        }));

        // Clear notification toast after 5 seconds
        setTimeout(() => {
          setPaymentNotification(null);
        }, 5000);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  const formatAmount = (sats) => {
    return new Intl.NumberFormat('ko-KR').format(sats);
  };

  return (
    <>
      {paymentNotification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          backgroundColor: '#10b981',
          color: 'white',
          padding: '16px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 10000,
          animation: 'slideIn 0.3s ease-out',
          fontWeight: '500'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <div>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>결제 완료!</div>
              <div>{formatAmount(paymentNotification.amount)} sats를 받았습니다</div>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && paymentDetails && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10001,
          animation: 'fadeIn 0.3s ease-out'
        }} onClick={() => setShowPaymentModal(false)}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '48px',
            maxWidth: '480px',
            width: '90%',
            textAlign: 'center',
            animation: 'scaleIn 0.3s ease-out'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px'
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </div>

            <h2 style={{
              fontSize: '28px',
              fontWeight: '700',
              color: '#10b981',
              marginBottom: '16px'
            }}>결제 완료!</h2>

            <p style={{
              fontSize: '48px',
              fontWeight: '700',
              color: '#1f2937',
              margin: '24px 0'
            }}>
              {formatAmount(paymentDetails.amount)} <span style={{ fontSize: '24px', color: '#6b7280' }}>sats</span>
            </p>

            <p style={{
              fontSize: '16px',
              color: '#6b7280',
              marginBottom: '32px'
            }}>라이트닝 결제를 성공적으로 받았습니다!</p>

            <button
              onClick={() => setShowPaymentModal(false)}
              style={{
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 32px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#059669'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#10b981'}
            >
              확인
            </button>
          </div>
        </div>
      )}

      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Wallet />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/wallet/receive" element={<Wallet />} />
            <Route path="/about" element={<About />} />
            <Route path="/map" element={<StoreFinder />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </Router>
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes scaleIn {
          from {
            transform: scale(0.9);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}

function App() {
  useEffect(() => {
    // Initialize dark mode on app load
    try {
      const saved = localStorage.getItem('app_settings');
      const darkMode = saved ? JSON.parse(saved).darkMode : true; // Default to true (dark mode)
      document.documentElement.classList.toggle('dark', darkMode !== false);
    } catch (e) {
      console.error('Failed to load dark mode setting:', e);
      document.documentElement.classList.add('dark'); // Default to dark mode on error
    }
  }, []);

  return (
    <WebSocketProvider>
      <AppContent />
    </WebSocketProvider>
  );
}

export default App;
