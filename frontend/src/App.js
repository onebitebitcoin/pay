import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import InstallPrompt from './components/InstallPrompt';
import About from './pages/About';
import StoreFinder from './pages/StoreFinder';
import Wallet from './pages/Wallet';
import Settings from './pages/Settings';
import AddStore from './pages/AddStore';
import TransactionDetail from './pages/TransactionDetail';
import PaymentSuccess from './pages/PaymentSuccess';
import StoreManagement from './pages/StoreManagement';
import { applyTheme, getStoredTheme } from './utils/theme';

function AppContent() {
  return (
    <Router>
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
          <Route path="/admin/stores" element={<StoreManagement />} />
          <Route path="/admin/stores/add" element={<AddStore />} />
          <Route path="/settings/add-store" element={<AddStore />} />
        </Routes>
      </Layout>
    </Router>
  );
}

function App() {
  useEffect(() => {
    const initialTheme = getStoredTheme();
    applyTheme(initialTheme);

    const handleStorage = (event) => {
      if (event.key !== 'app_settings' || !event.newValue) {
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed && parsed.theme) {
          applyTheme(parsed.theme);
        }
      } catch (error) {
        console.error('Failed to apply theme from storage', error);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return (
    <AppContent />
  );
}

export default App;
