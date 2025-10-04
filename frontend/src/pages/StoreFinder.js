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
  const [userLocation, setUserLocation] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [sortByDistance, setSortByDistance] = useState(false);
  const [manualMapControl, setManualMapControl] = useState(false);
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
  const infowindowsRef = useRef([]);
  const mapClickHandlerRef = useRef(null);
  const geocoderRef = useRef(null);
  const tempMarkerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const currentInfowindowRef = useRef(null);

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
  }, [searchQuery, stores, selectedCategory, sortByDistance, userLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = ['전체', ...new Set(stores.map(s => s.category).filter(Boolean))];

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
  };

  const getUserLocation = () => {
    if (!navigator.geolocation) {
      alert('이 브라우저는 위치 서비스를 지원하지 않습니다.');
      return;
    }

    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        setSortByDistance(true);

        // Move map to user location
        if (kakaoMapRef.current && window.kakao) {
          const moveLatLon = new window.kakao.maps.LatLng(latitude, longitude);
          kakaoMapRef.current.setCenter(moveLatLon);
          kakaoMapRef.current.setLevel(5); // Level 5 shows approximately 1-2km radius

          // Add user location marker
          if (userMarkerRef.current) {
            userMarkerRef.current.setMap(null);
          }

          const imageSrc = 'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png';
          const imageSize = new window.kakao.maps.Size(24, 35);
          const markerImage = new window.kakao.maps.MarkerImage(imageSrc, imageSize);

          const marker = new window.kakao.maps.Marker({
            position: moveLatLon,
            image: markerImage,
            title: '내 위치'
          });

          marker.setMap(kakaoMapRef.current);
          userMarkerRef.current = marker;
        }

        setLoadingLocation(false);
      },
      (error) => {
        console.error('위치 가져오기 실패:', error);
        let errorMsg = '위치를 가져올 수 없습니다.';
        if (error.code === 1) {
          errorMsg = '위치 접근 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.';
        } else if (error.code === 2) {
          errorMsg = '위치를 확인할 수 없습니다.';
        } else if (error.code === 3) {
          errorMsg = '위치 요청 시간이 초과되었습니다.';
        }
        alert(errorMsg);
        setLoadingLocation(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

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

    // Clear existing markers and infowindows
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];
    infowindowsRef.current = [];

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
          <div style="padding: 15px; width: 250px; text-align: center; background: white; border-radius: 8px;">
            <h3 style="margin: 0 0 8px 0; color: #1f2937; font-size: 16px; font-weight: 700;">${store.name}</h3>
            <p style="margin: 0 0 5px 0; color: #2563eb; font-size: 14px; font-weight: 600;">${store.category}</p>
            <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 12px; line-height: 1.4;">${store.address}</p>
            <button
              id="store-detail-btn-${store.id}"
              style="
                padding: 6px 12px;
                background: #2563eb;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                transition: background 0.2s;
              "
              onmouseover="this.style.background='#1d4ed8'"
              onmouseout="this.style.background='#2563eb'"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              자세히 보기
            </button>
          </div>
        `
      });

      // Add click event to marker
      window.kakao.maps.event.addListener(marker, 'click', () => {
        // Close previous infowindow
        if (currentInfowindowRef.current) {
          currentInfowindowRef.current.close();
        }

        infowindow.open(kakaoMapRef.current, marker);
        currentInfowindowRef.current = infowindow;

        // Attach click event to detail button after infowindow is rendered
        setTimeout(() => {
          const detailBtn = document.getElementById(`store-detail-btn-${store.id}`);
          if (detailBtn) {
            detailBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              openStoreDetail(store);
            };
          }
        }, 100);
      });

      markersRef.current.push(marker);
      infowindowsRef.current.push({ storeId: store.id, marker, infowindow });
    });

    // Adjust map bounds to show all markers (skip if user location mode is active or manual control)
    if (storeData.length > 0 && !sortByDistance && !manualMapControl) {
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

    // Add distance and sort if user location is available
    if (sortByDistance && userLocation) {
      filtered = filtered.map(store => ({
        ...store,
        distance: calculateDistance(userLocation.lat, userLocation.lng, store.lat, store.lng)
      })).sort((a, b) => a.distance - b.distance);
    }

    // Reset manual control when filters change
    setManualMapControl(false);

    setFilteredStores(filtered);
    updateMapMarkers(filtered);
  };

  const handleStoreClick = (store) => {
    if (kakaoMapRef.current && window.kakao) {
      setManualMapControl(true); // Prevent auto bounds adjustment

      const moveLatLon = new window.kakao.maps.LatLng(store.lat, store.lng);
      kakaoMapRef.current.setCenter(moveLatLon);
      kakaoMapRef.current.setLevel(3); // Zoom in

      // Find and open the corresponding infowindow
      const storeMarkerData = infowindowsRef.current.find(item => item.storeId === store.id);
      if (storeMarkerData) {
        // Close previous infowindow
        if (currentInfowindowRef.current) {
          currentInfowindowRef.current.close();
        }

        storeMarkerData.infowindow.open(kakaoMapRef.current, storeMarkerData.marker);
        currentInfowindowRef.current = storeMarkerData.infowindow;

        // Attach click event to detail button
        setTimeout(() => {
          const detailBtn = document.getElementById(`store-detail-btn-${store.id}`);
          if (detailBtn) {
            detailBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              openStoreDetail(store);
            };
          }
        }, 100);
      }
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

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      alert(`${label}이(가) 클립보드에 복사되었습니다.`);
    } catch (err) {
      console.error('복사 실패:', err);
      alert('복사에 실패했습니다.');
    }
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
            onClick={getUserLocation}
            className={`location-btn ${sortByDistance ? 'active' : ''}`}
            disabled={loadingLocation}
          >
            <Icon name="map" size={18} /> {loadingLocation ? '위치 확인 중...' : sortByDistance ? '내 주변 매장 ✓' : '내 주변 매장'}
          </button>
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
            비트코인 매장 ({filteredStores.length}개) {sortByDistance && userLocation && '· 거리순'}
          </h3>
          <div className="store-list">
            {filteredStores.map(store => (
              <div
                key={store.id}
                className="store-card"
              >
                <div className="store-card-content">
                  <div className="store-card-header">
                    <h4 className="store-name">
                      {store.name}
                      {sortByDistance && store.distance !== undefined && (
                        <span className="store-distance"> · {store.distance < 1 ? `${Math.round(store.distance * 1000)}m` : `${store.distance.toFixed(1)}km`}</span>
                      )}
                    </h4>
                    <div className="store-card-actions">
                      <button
                        type="button"
                        className="store-action-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStoreClick(store);
                        }}
                        title="위치 보기"
                      >
                        <Icon name="map" size={18} />
                      </button>
                      <button
                        type="button"
                        className="store-action-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          openStoreDetail(store);
                        }}
                        title="자세히"
                      >
                        <Icon name="info" size={18} />
                      </button>
                    </div>
                  </div>
                  <p className="store-address">{store.address}</p>
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
                  <div style={{ flex: 1 }}>
                    <strong>주소</strong>
                    <p>{selectedStore.address}</p>
                  </div>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => copyToClipboard(selectedStore.address, '주소')}
                    title="주소 복사"
                  >
                    <Icon name="copy" size={16} />
                  </button>
                </div>
                {selectedStore.phone && (
                  <div className="store-detail-item">
                    <Icon name="info" size={18} />
                    <div style={{ flex: 1 }}>
                      <strong>전화번호</strong>
                      <p>{selectedStore.phone}</p>
                    </div>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => copyToClipboard(selectedStore.phone, '전화번호')}
                      title="전화번호 복사"
                    >
                      <Icon name="copy" size={16} />
                    </button>
                  </div>
                )}
                {selectedStore.hours && (
                  <div className="store-detail-item">
                    <Icon name="clock" size={18} />
                    <div style={{ flex: 1 }}>
                      <strong>영업시간</strong>
                      <p>{selectedStore.hours}</p>
                    </div>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => copyToClipboard(selectedStore.hours, '영업시간')}
                      title="영업시간 복사"
                    >
                      <Icon name="copy" size={16} />
                    </button>
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
            <button type="button" className="sf-btn" onClick={closeStoreDetail}>닫기</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export default StoreFinder;
