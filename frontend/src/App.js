import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import About from './pages/About';
import StoreFinder from './pages/StoreFinder';
import Wallet from './pages/Wallet';
import Settings from './pages/Settings';
import TransactionDetail from './pages/TransactionDetail';
import PaymentSuccess from './pages/PaymentSuccess';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext';
// Removed legacy global styles to prevent CSS conflicts

function PaymentListener() {
  const { subscribe } = useWebSocket();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Subscribe to WebSocket messages
    const unsubscribe = subscribe('app-payment-listener', (message) => {
      if (message.type === 'payment_received') {
        console.log('Payment received notification:', message);

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

        // Navigate to payment success page from any page
        const currentPath = location.pathname;
        navigate('/wallet/payment-success', {
          state: {
            amount: message.amount,
            returnTo: currentPath
          }
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe, navigate, location]);

  return null;
}

function AppContent() {
  return (
    <Router>
      <PaymentListener />
      <Layout>
        <Routes>
          <Route path="/" element={<Wallet />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/wallet/receive" element={<Wallet />} />
          <Route path="/wallet/send" element={<Wallet />} />
          <Route path="/wallet/payment-success" element={<PaymentSuccess />} />
          <Route path="/wallet/transaction/:id" element={<TransactionDetail />} />
          <Route path="/about" element={<About />} />
          <Route path="/map" element={<StoreFinder />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
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
