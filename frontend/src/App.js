import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import InstallPrompt from './components/InstallPrompt';
import About from './pages/About';
import StoreFinder from './pages/StoreFinder';
import Wallet from './pages/Wallet';
import Settings from './pages/Settings';
import AddStore from './pages/AddStore';
import TransactionDetail from './pages/TransactionDetail';
import PaymentSuccess from './pages/PaymentSuccess';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext';
// Removed legacy global styles to prevent CSS conflicts

function PaymentListener() {
  const { subscribe } = useWebSocket();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    console.log('[PaymentListener] Subscribing to WebSocket messages...');

    // Subscribe to WebSocket messages
    const unsubscribe = subscribe('app-payment-listener', (message) => {
      console.log('[PaymentListener] WebSocket message received:', message);

      if (message.type === 'payment_received') {
        console.log('[PaymentListener] Payment received notification:', message);

        // Dispatch custom event so Wallet component can update balance
        console.log('[PaymentListener] Dispatching payment_received event...');
        window.dispatchEvent(new CustomEvent('payment_received', {
          detail: {
            amount: message.amount,
            quote: message.quote,
            timestamp: message.timestamp,
            signatures: message.signatures,
            keysetId: message.keysetId
          }
        }));
        console.log('[PaymentListener] Event dispatched');

        // Wait a bit before navigating to allow transaction to be saved
        console.log('[PaymentListener] Waiting 200ms before navigation...');
        setTimeout(() => {
          // Navigate to payment success page from any page
          const currentPath = location.pathname;
          console.log('[PaymentListener] Navigating to payment-success from:', currentPath);
          navigate('/wallet/payment-success', {
            state: {
              amount: message.amount,
              returnTo: currentPath,
              type: 'receive'
            }
          });
        }, 200);
      }
    });

    console.log('[PaymentListener] Subscription complete');

    return () => {
      console.log('[PaymentListener] Unsubscribing...');
      unsubscribe();
    };
  }, [subscribe, navigate, location]);

  return null;
}

function AppContent() {
  return (
    <Router>
      <PaymentListener />
      <InstallPrompt />
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
          <Route path="/settings/add-store" element={<AddStore />} />
        </Routes>
      </Layout>
    </Router>
  );
}

function App() {
  return (
    <WebSocketProvider>
      <AppContent />
    </WebSocketProvider>
  );
}

export default App;
