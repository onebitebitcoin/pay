import React from 'react';
import { Link } from 'react-router-dom';
import './Home.css';
import Icon from '../components/Icon';

function Home() {
  return (
    <div className="home">
      <div className="hero">
        <div className="hero-content">
          <h1 className="hero-title">
            <span className="bitcoin-icon"><Icon name="bitcoin" size={64} /></span>
            한입 결제
          </h1>
          <p className="hero-subtitle">
            비트코인으로 결제할 수 있는 매장을 찾고, 라이트닝 지갑으로 즉시 결제하세요
          </p>
          
          <div className="feature-cards">
            <Link to="/map" className="feature-card">
              <div className="feature-icon"><Icon name="map" size={48} /></div>
              <h3>매장 찾기</h3>
              <p>카카오맵으로 비트코인 결제 가능한 매장을 찾아보세요</p>
            </Link>
            
            <Link to="/wallet" className="feature-card">
              <div className="feature-icon"><Icon name="shield" size={48} /></div>
              <h3>Cashu 지갑</h3>
              <p>Cashu 기반 프라이버시 중심 라이트닝 지갑</p>
            </Link>
          </div>
        </div>
      </div>
      
      <div className="stats-section">
        <div className="stats-container">
          <div className="stat-item">
            <div className="stat-number">15</div>
            <div className="stat-label">비트코인 매장</div>
          </div>
          <div className="stat-item">
            <div className="stat-number">50K+</div>
            <div className="stat-label">총 거래량 (sats)</div>
          </div>
          <div className="stat-item">
            <div className="stat-number">100%</div>
            <div className="stat-label">프라이버시 보호</div>
          </div>
        </div>
      </div>
      
      <div className="info-section">
        <div className="info-content">
          <h2>왜 비트코인인가요?</h2>
          <div className="info-grid">
            <div className="info-item">
              <div className="info-icon"><Icon name="lock" size={48} /></div>
              <h4>프라이버시</h4>
              <p>Cashu eCash로 완전한 프라이버시 보호</p>
            </div>
            <div className="info-item">
              <div className="info-icon"><Icon name="bolt" size={48} /></div>
              <h4>즉시 결제</h4>
              <p>라이트닝 네트워크로 즉시 결제 가능</p>
            </div>
            <div className="info-item">
              <div className="info-icon"><Icon name="globe" size={48} /></div>
              <h4>글로벌</h4>
              <p>국경 없는 글로벌 결제 시스템</p>
            </div>
            <div className="info-item">
              <div className="info-icon"><Icon name="diamond" size={48} /></div>
              <h4>디지털 골드</h4>
              <p>인플레이션으로부터 자산 보호</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;
