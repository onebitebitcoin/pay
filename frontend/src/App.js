import React from 'react';
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
// Removed WebSocket functionality - using polling instead

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
          <Route path="/settings/add-store" element={<AddStore />} />
        </Routes>
      </Layout>
    </Router>
  );
}

function App() {
  return (
    <AppContent />
  );
}

export default App;
