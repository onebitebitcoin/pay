import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import About from './pages/About';
import StoreFinder from './pages/StoreFinder';
import Wallet from './pages/Wallet';
import Settings from './pages/Settings';
// Removed legacy global styles to prevent CSS conflicts

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Wallet />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/about" element={<About />} />
          <Route path="/map" element={<StoreFinder />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
