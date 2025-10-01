import React, { useState, useEffect, useRef } from 'react';
import './StoreFinder.css';
import Icon from '../components/Icon';
import { apiUrl, loadKakaoSdk } from '../config';

function StoreFinder() {
  const [stores, setStores] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredStores, setFilteredStores] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('전체');
  // const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedStore, setSelectedStore] = useState(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState(null);
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
  const markersRef = useRef([]);
  const mapClickHandlerRef = useRef(null);
  const geocoderRef = useRef(null);
  const tempMarkerRef = useRef(null);

  useEffect(() => {
    fetchStores();
  }, []);

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

  useEffect(() => {
    filterStores();
  }, [searchQuery, stores, selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = ['전체', ...new Set(stores.map(s => s.category).filter(Boolean))];

  const fetchStores = async () => {
    try {
      const response = await fetch(apiUrl('/api/stores'));
      const data = await response.json();
      setStores(data);
    } catch (error) {
      console.error('매장 데이터 가져오기 오류:', error);
    }
  };

  // Helpers for geocoding and preview marker
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
            // 지오코딩으로 좌표 업데이트
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


  const openAddModal = () => {
    setNewStore(createEmptyStore());
    if (tempMarkerRef.current) {
      tempMarkerRef.current.setMap(null);
      tempMarkerRef.current = null;
    }
    if (kakaoMapRef.current && window.kakao && mapClickHandlerRef.current) {
      window.kakao.maps.event.removeListener(kakaoMapRef.current, 'click', mapClickHandlerRef.current);
      mapClickHandlerRef.current = null;
    }
    setShowAddModal(true);
    setAdding(true);
    // enable map click to set coordinates
    if (kakaoMapRef.current && window.kakao) {
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
    }
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setAdding(false);
    setNewStore(createEmptyStore());
    if (kakaoMapRef.current && window.kakao && mapClickHandlerRef.current) {
      window.kakao.maps.event.removeListener(kakaoMapRef.current, 'click', mapClickHandlerRef.current);
      mapClickHandlerRef.current = null;
    }
    if (tempMarkerRef.current) {
      tempMarkerRef.current.setMap(null);
      tempMarkerRef.current = null;
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
      // 주소로 좌표를 우선 시도
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
      const created = await resp.json();
      await fetchStores();
      // focus on new store
      if (kakaoMapRef.current && window.kakao) {
        const moveLatLon = new window.kakao.maps.LatLng(created.lat, created.lng);
        kakaoMapRef.current.setCenter(moveLatLon);
        kakaoMapRef.current.setLevel(4);
      }
      closeAddModal();
      alert('매장이 등록되었습니다');
    } catch (e) {
      console.error(e);
      alert(e.message || '매장 등록 중 오류가 발생했습니다');
    } finally {
      setSubmitLoading(false);
    }
  };

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
    });
  };

  const updateMapMarkers = (storeData) => {
    if (!kakaoMapRef.current || !window.kakao) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];

    // Create custom marker image for Bitcoin stores
    const svgIcon = `
      <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10.8 15 25 15 25s15-14.2 15-25C30 6.7 23.3 0 15 0z" fill="#2563eb"/>
        <circle cx="15" cy="15" r="10" fill="#ffffff"/>
        <text x="15" y="19" text-anchor="middle" fill="#2563eb" font-size="12" font-weight="bold">B</text>
      </svg>
    `;
    const imageSrc = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgIcon);
    
    const imageSize = new window.kakao.maps.Size(30, 40);
    const imageOption = { offset: new window.kakao.maps.Point(15, 40) };
    const markerImage = new window.kakao.maps.MarkerImage(imageSrc, imageSize, imageOption);

    // Add new markers
    storeData.forEach(store => {
      const markerPosition = new window.kakao.maps.LatLng(store.lat, store.lng);
      
      const marker = new window.kakao.maps.Marker({
        position: markerPosition,
        image: markerImage,
        title: store.name
      });

      marker.setMap(kakaoMapRef.current);

      // Create info window
      const infowindow = new window.kakao.maps.InfoWindow({
        content: `
          <div style="padding: 15px; width: 250px; text-align: center; color: var(--text);">
            <h3 style="margin: 0 0 8px 0; color: var(--text); font-size: 16px;">${store.name}</h3>
            <p style="margin: 0 0 5px 0; color: var(--primary); font-size: 14px; font-weight: 600;">${store.category}</p>
            <p style="margin: 0; color: var(--muted); font-size: 12px; line-height: 1.4;">${store.address}</p>
          </div>
        `
      });

      // Add click event to marker
      window.kakao.maps.event.addListener(marker, 'click', () => {
        infowindow.open(kakaoMapRef.current, marker);
      });

      markersRef.current.push(marker);
    });

    // Adjust map bounds to show all markers
    if (storeData.length > 0) {
      const bounds = new window.kakao.maps.LatLngBounds();
      storeData.forEach(store => {
        bounds.extend(new window.kakao.maps.LatLng(store.lat, store.lng));
      });
      kakaoMapRef.current.setBounds(bounds);
    }
  };

  const filterStores = () => {
    let filtered = stores;

    // Category filter
    if (selectedCategory !== '전체') {
      filtered = filtered.filter(store => store.category === selectedCategory);
    }

    // Search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(store =>
        store.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        store.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        store.address.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredStores(filtered);
    updateMapMarkers(filtered);
  };

  const handleStoreClick = (store) => {
    if (kakaoMapRef.current && window.kakao) {
      const moveLatLon = new window.kakao.maps.LatLng(store.lat, store.lng);
      kakaoMapRef.current.setCenter(moveLatLon);
      kakaoMapRef.current.setLevel(3); // Zoom in
    }
  };

  const openStoreDetail = (store) => {
    setSelectedStore(store);
    setShowDetailModal(true);
  };

  const closeStoreDetail = () => {
    setShowDetailModal(false);
    setSelectedStore(null);
  };

  const handleDeleteStore = async (store) => {
    if (!store || !store.id) return;
    if (deleteLoadingId) return;
    if (!window.confirm(`정말로 "${store.name}" 매장을 삭제하시겠습니까?`)) return;

    try {
      setDeleteLoadingId(store.id);
      const resp = await fetch(apiUrl(`/api/stores/${store.id}`), {
        method: 'DELETE',
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || '매장 삭제에 실패했습니다');
      }
      await fetchStores();
      if (selectedStore && selectedStore.id === store.id) {
        closeStoreDetail();
      }
    } catch (error) {
      console.error('매장 삭제 오류:', error);
      alert(error.message || '매장 삭제에 실패했습니다');
    } finally {
      setDeleteLoadingId(null);
    }
  };

  return (
    <>
    <div className="store-finder">
      <div className="category-filter">
        <label className="category-label" htmlFor="category-select">카테고리</label>
        <select
          id="category-select"
          className="category-select"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      <div className="controls">
          <div className="search-container">
            <input
              type="text"
              placeholder="매장명, 카테고리, 주소로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="add-store-btn"
            disabled={adding}
          >
            <Icon name="plus" size={18} /> 매장 등록
          </button>
        </div>

      <div className="store-finder-content">
        <div className="map-container">
          <div ref={mapRef} className="map" />
        </div>

        <div className="store-finder-sidebar">
          <h3 className="sidebar-title">
            비트코인 매장 ({filteredStores.length}개)
          </h3>
          <div className="store-list">
            {filteredStores.map(store => (
              <div
                key={store.id}
                className="store-card"
              >
                <div className="store-card-content">
                  <h4 className="store-name">{store.name}</h4>
                  <p className="store-category">{store.category}</p>
                  <p className="store-address">{store.address}</p>
                </div>
                <div className="store-card-actions">
                  <button
                    type="button"
                    className="store-action-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStoreClick(store);
                    }}
                  >
                    <Icon name="map" size={14} /> 위치 보기
                  </button>
                  <button
                    type="button"
                    className="store-action-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      openStoreDetail(store);
                    }}
                  >
                    <Icon name="info" size={14} /> 자세히
                  </button>
                  <button
                    type="button"
                    className="store-action-link danger"
                    disabled={deleteLoadingId === store.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteStore(store);
                    }}
                  >
                    <Icon name="trash" size={14} /> {deleteLoadingId === store.id ? '삭제 중...' : '삭제'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    {showAddModal && (
      <div className="sf-modal-overlay" onClick={closeAddModal}>
        <div className="sf-modal" onClick={(e) => e.stopPropagation()}>
          <div className="sf-modal-header">
            <h3>매장 등록</h3>
            <button className="sf-modal-close" onClick={closeAddModal} aria-label="닫기">
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="sf-modal-body">
            <div className="sf-tip">카카오 주소검색을 이용해 위치를 찾거나 지도를 클릭해 위도/경도를 지정하세요.</div>
            <div className="sf-form-grid">
              <label>
                <span>이름</span>
                <input
                  type="text"
                  value={newStore.name}
                  onChange={(e)=>setNewStore((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="예: 한입 비트코인 카페"
                />
              </label>
              <label>
                <span>카테고리</span>
                <input
                  type="text"
                  value={newStore.category}
                  onChange={(e)=>setNewStore((prev) => ({ ...prev, category: e.target.value }))}
                  placeholder="예: 카페, 음식점, 편의점"
                />
              </label>
              <label>
                <span>전화번호</span>
                <input
                  type="tel"
                  value={newStore.phone}
                  onChange={(e)=>setNewStore((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="예: 02-123-4567"
                />
              </label>
              <label>
                <span>영업시간</span>
                <input
                  type="text"
                  value={newStore.hours}
                  onChange={(e)=>setNewStore((prev) => ({ ...prev, hours: e.target.value }))}
                  placeholder="예: 매일 09:00~21:00"
                />
              </label>
              <label className="sf-col-span">
                <span>주소</span>
                <div className="sf-inline-row">
                  <input
                    type="text"
                    value={newStore.address}
                    onChange={(e)=>setNewStore((prev) => ({ ...prev, address: e.target.value, lat: null, lng: null }))}
                    onBlur={geocodeAddress}
                    onKeyDown={(e)=>{ if (e.key === 'Enter') { e.preventDefault(); geocodeAddress(); } }}
                  />
                  <button type="button" className="sf-small-btn" onClick={openAddressSearch}>주소 검색</button>
                </div>
              </label>
              <label className="sf-col-span">
                <span>매장 설명</span>
                <textarea
                  rows={3}
                  value={newStore.description}
                  onChange={(e)=>setNewStore((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="예: 비트코인·라이트닝 결제가 가능한 스페셜티 커피 전문점입니다."
                />
              </label>
            </div>
          </div>
          <div className="sf-modal-actions">
            <button className="sf-btn" onClick={closeAddModal}>취소</button>
            <button className="sf-btn primary" onClick={submitNewStore} disabled={submitLoading}>
              {submitLoading ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      </div>
    )}
    {showDetailModal && selectedStore && (
      <div className="sf-modal-overlay" onClick={closeStoreDetail}>
        <div className="sf-modal" onClick={(e) => e.stopPropagation()}>
          <div className="sf-modal-header">
            <h3>매장 정보</h3>
            <button className="sf-modal-close" onClick={closeStoreDetail} aria-label="닫기">
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="sf-modal-body">
            <div className="store-detail-section">
              <div className="store-detail-header">
                <h2 className="store-detail-name">{selectedStore.name}</h2>
                <span className="store-detail-category">{selectedStore.category}</span>
              </div>
              <div className="store-detail-info">
                <div className="store-detail-item">
                  <Icon name="map" size={18} />
                  <div>
                    <strong>주소</strong>
                    <p>{selectedStore.address}</p>
                  </div>
                </div>
                {selectedStore.phone && (
                  <div className="store-detail-item">
                    <Icon name="info" size={18} />
                    <div>
                      <strong>전화번호</strong>
                      <p>{selectedStore.phone}</p>
                    </div>
                  </div>
                )}
                {selectedStore.hours && (
                  <div className="store-detail-item">
                    <Icon name="clock" size={18} />
                    <div>
                      <strong>영업시간</strong>
                      <p>{selectedStore.hours}</p>
                    </div>
                  </div>
                )}
                {selectedStore.description && (
                  <div className="store-detail-item">
                    <Icon name="info" size={18} />
                    <div>
                      <strong>설명</strong>
                      <p>{selectedStore.description}</p>
                    </div>
                  </div>
                )}
                <div className="store-detail-item">
                  <Icon name="bitcoin" size={18} />
                  <div>
                    <strong>비트코인 결제</strong>
                    <p>이 매장에서는 비트코인 및 라이트닝 결제가 가능합니다.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="sf-modal-actions">
            <button
              type="button"
              className="sf-btn danger"
              disabled={deleteLoadingId === selectedStore.id}
              onClick={() => handleDeleteStore(selectedStore)}
            >
              <Icon name="trash" size={16} /> {deleteLoadingId === selectedStore.id ? '삭제 중...' : '삭제'}
            </button>
            <button
              type="button"
              className="sf-btn primary"
              onClick={() => {
                handleStoreClick(selectedStore);
                closeStoreDetail();
              }}
            >
              <Icon name="map" size={16} /> 지도에서 보기
            </button>
            <button type="button" className="sf-btn" onClick={closeStoreDetail}>닫기</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export default StoreFinder;
