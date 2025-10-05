import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, loadKakaoSdk } from '../config';
import Icon from '../components/Icon';
import './AddStore.css';

function AddStore() {
  const navigate = useNavigate();
  const [submitLoading, setSubmitLoading] = useState(false);
  const createEmptyStore = () => ({
    name: '',
    category: '',
    address: '',
    phone: '',
    hours: '',
    description: '',
    lat: null,
    lng: null,
  });
  const [newStore, setNewStore] = useState(createEmptyStore);
  const mapRef = useRef();
  const kakaoMapRef = useRef();
  const geocoderRef = useRef(null);
  const tempMarkerRef = useRef(null);
  const mapClickHandlerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadKakaoSdk()
      .then(() => {
        if (!cancelled) initKakaoMap();
      })
      .catch((err) => {
        console.error('카카오맵 SDK 로드 실패:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const initKakaoMap = () => {
    if (!window.kakao || !window.kakao.maps) {
      console.error('카카오맵 API가 로드되지 않았습니다');
      return;
    }

    window.kakao.maps.load(() => {
      const container = mapRef.current;
      const options = {
        center: new window.kakao.maps.LatLng(37.5665, 126.9780), // Seoul
        level: 6
      };

      kakaoMapRef.current = new window.kakao.maps.Map(container, options);

      if (window.kakao.maps.services) {
        geocoderRef.current = new window.kakao.maps.services.Geocoder();
      }

      // Enable map click to set coordinates
      const handler = (mouseEvent) => {
        const latlng = mouseEvent.latLng;
        setNewStore((prev) => ({
          ...prev,
          lat: latlng.getLat(),
          lng: latlng.getLng(),
        }));
        updateTempMarker(latlng.getLat(), latlng.getLng());
      };
      window.kakao.maps.event.addListener(kakaoMapRef.current, 'click', handler);
      mapClickHandlerRef.current = handler;
    });
  };

  const updateTempMarker = (lat, lng) => {
    if (!kakaoMapRef.current || !window.kakao) return;
    const pos = new window.kakao.maps.LatLng(lat, lng);
    if (!tempMarkerRef.current) {
      tempMarkerRef.current = new window.kakao.maps.Marker({ position: pos });
    } else {
      tempMarkerRef.current.setPosition(pos);
    }
    tempMarkerRef.current.setMap(kakaoMapRef.current);
    kakaoMapRef.current.setCenter(pos);
  };

  const geocodeAddress = () => {
    if (!geocoderRef.current || !newStore.address) return;
    geocoderRef.current.addressSearch(newStore.address, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result && result.length) {
        const { x, y } = result[0];
        const lat = parseFloat(y);
        const lng = parseFloat(x);
        setNewStore((prev) => ({ ...prev, lat, lng }));
        updateTempMarker(lat, lng);
      } else {
        alert('주소를 찾을 수 없습니다. 다른 표현으로 시도해보세요.');
      }
    });
  };

  const openAddressSearch = () => {
    if (!window.daum) {
      alert('주소 검색 스크립트가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    const openPostcode = () => {
      const postcode = new window.daum.Postcode({
        oncomplete: function(data) {
          const addr = data.roadAddress || data.jibunAddress || '';
          if (addr) {
            setNewStore((prev) => ({ ...prev, address: addr, lat: null, lng: null }));
            setTimeout(() => geocodeAddress(), 0);
          }
        }
      });
      postcode.open();
    };
    if (window.daum.postcode && typeof window.daum.postcode.load === 'function') {
      window.daum.postcode.load(openPostcode);
    } else {
      openPostcode();
    }
  };

  const submitNewStore = async () => {
    const { name, category, address, phone, hours, description, lat, lng } = newStore;
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    const trimmedAddress = address.trim();
    if (!trimmedName || !trimmedCategory || !trimmedAddress) {
      alert('이름, 카테고리, 주소를 입력하세요');
      return;
    }
    if (lat == null || lng == null) {
      geocodeAddress();
      alert('주소 기반 위치를 찾는 중입니다. 다시 저장을 눌러주세요.');
      return;
    }
    try {
      setSubmitLoading(true);
      const payload = {
        name: trimmedName,
        category: trimmedCategory,
        address: trimmedAddress,
        lat: Number(lat),
        lng: Number(lng),
        phone: phone.trim() ? phone.trim() : null,
        hours: hours.trim() ? hours.trim() : null,
        description: description.trim() ? description.trim() : null,
      };
      const resp = await fetch(apiUrl('/api/stores'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || '매장 등록 실패');
      }
      alert('매장이 등록되었습니다');
      navigate('/map');
    } catch (e) {
      console.error(e);
      alert(e.message || '매장 등록 중 오류가 발생했습니다');
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="add-store-page">
      <div className="add-store-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <Icon name="chevron-down" size={20} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <h1>매장 등록</h1>
        <div style={{ width: '32px' }} />
      </div>

      <div className="add-store-content">
        <div className="map-section">
          <div ref={mapRef} className="add-store-map" />
          <div className="map-tip">
            지도를 클릭하거나 주소를 입력하여 위치를 지정하세요
          </div>
        </div>

        <div className="form-section">
          <div className="form-grid">
            <label>
              <span>매장 이름 <span className="required">*</span></span>
              <input
                type="text"
                value={newStore.name}
                onChange={(e) => setNewStore((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="예: 한입만 카페"
              />
            </label>

            <label>
              <span>카테고리 <span className="required">*</span></span>
              <input
                type="text"
                value={newStore.category}
                onChange={(e) => setNewStore((prev) => ({ ...prev, category: e.target.value }))}
                placeholder="예: 카페, 음식점, 편의점"
              />
            </label>

            <label>
              <span>전화번호</span>
              <input
                type="tel"
                value={newStore.phone}
                onChange={(e) => setNewStore((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="예: 02-123-4567"
              />
            </label>

            <label>
              <span>영업시간</span>
              <input
                type="text"
                value={newStore.hours}
                onChange={(e) => setNewStore((prev) => ({ ...prev, hours: e.target.value }))}
                placeholder="예: 매일 09:00~21:00"
              />
            </label>

            <label className="col-span-2">
              <span>주소 <span className="required">*</span></span>
              <div className="address-input-row">
                <input
                  type="text"
                  value={newStore.address}
                  onChange={(e) => setNewStore((prev) => ({ ...prev, address: e.target.value, lat: null, lng: null }))}
                  onBlur={geocodeAddress}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); geocodeAddress(); } }}
                  placeholder="주소를 입력하세요"
                />
                <button type="button" className="search-btn" onClick={openAddressSearch}>
                  주소 검색
                </button>
              </div>
            </label>

            <label className="col-span-2">
              <span>매장 설명</span>
              <textarea
                rows={3}
                value={newStore.description}
                onChange={(e) => setNewStore((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="예: 비트코인·라이트닝 결제가 가능한 스페셜티 커피 전문점입니다."
              />
            </label>
          </div>

          <div className="form-actions">
            <button className="cancel-btn" onClick={() => navigate(-1)}>
              취소
            </button>
            <button className="submit-btn" onClick={submitNewStore} disabled={submitLoading}>
              {submitLoading ? '등록 중...' : '등록하기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AddStore;
