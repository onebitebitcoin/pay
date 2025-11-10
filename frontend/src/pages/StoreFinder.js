import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './StoreFinder.css';
import Icon from '../components/Icon';
import { apiUrl, loadKakaoSdk } from '../config';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const STORE_MARKER_SVG = `
  <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="storeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#fed7aa"/>
        <stop offset="100%" stop-color="#f97316"/>
      </linearGradient>
    </defs>
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.8 15 25 15 25s15-14.2 15-25C30 6.7 23.3 0 15 0z" fill="url(#storeGradient)"/>
    <circle cx="15" cy="15" r="10" fill="#fffaf4"/>
    <text x="15" y="19" text-anchor="middle" fill="#b45309" font-size="12" font-weight="bold">B</text>
  </svg>
`;
const STORE_MARKER_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(STORE_MARKER_SVG);

const USER_MARKER_SVG = `
  <svg width="24" height="35" viewBox="0 0 24 35" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 8.6 12 23 12 23s12-14.4 12-23C24 5.4 18.6 0 12 0z" fill="#fef3c7"/>
    <path d="M12 6l1.9 3.8 4.2.6-3.1 3 0.7 4.3-3.7-1.9-3.7 1.9 0.7-4.3-3.1-3 4.2-.6L12 6z" fill="#b45309"/>
  </svg>
`;
const USER_MARKER_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(USER_MARKER_SVG);

function StoreFinder() {
  const { t, i18n } = useTranslation();
  const [stores, setStores] = useState([]);
  const isKakao = i18n.language === 'ko';

  // Helper function to get localized store name
  const getStoreName = (store) => {
    if ((i18n.language === 'en' || i18n.language === 'ja') && store.name_en) {
      return store.name_en;
    }
    return store.name;
  };

  // Helper function to get localized address
  const getStoreAddress = (store) => {
    if ((i18n.language === 'en' || i18n.language === 'ja') && store.address_en) {
      return store.address_en;
    }
    return store.address;
  };

  // Helper function to get localized category
  const getStoreCategory = (store) => {
    if ((i18n.language === 'en' || i18n.language === 'ja') && store.category_en) {
      return store.category_en;
    }
    return store.category;
  };

  useEffect(() => {
    document.title = t('pageTitle.map');
  }, [t, i18n.language]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredStores, setFilteredStores] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  // const [loading, setLoading] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedStore, setSelectedStore] = useState(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [sortByDistance, setSortByDistance] = useState(false);
  const mapRef = useRef();
  const kakaoMapRef = useRef();
  const markersRef = useRef([]);
  const infowindowsRef = useRef([]);
  const userMarkerRef = useRef(null);
  const currentInfowindowRef = useRef(null);
  const leafletMapRef = useRef(null);
  const leafletMarkersRef = useRef([]);
  const leafletUserMarkerRef = useRef(null);
  const currentLeafletPopupRef = useRef(null);
  const latestFilteredStoresRef = useRef([]);

  useEffect(() => {
    fetchStores();
  }, []);

  const resetKakaoArtifacts = () => {
    markersRef.current.forEach(marker => {
      if (marker && typeof marker.setMap === 'function') {
        marker.setMap(null);
      }
    });
    markersRef.current = [];
    infowindowsRef.current = [];
    if (userMarkerRef.current && typeof userMarkerRef.current.setMap === 'function') {
      userMarkerRef.current.setMap(null);
    }
    userMarkerRef.current = null;
    currentInfowindowRef.current = null;
  };

  const clearLeafletStoreMarkers = () => {
    leafletMarkersRef.current.forEach(item => {
      if (item && item.marker) {
        item.marker.remove();
      }
    });
    leafletMarkersRef.current = [];
    currentLeafletPopupRef.current = null;
  };

  const resetLeafletArtifacts = () => {
    clearLeafletStoreMarkers();
    if (leafletUserMarkerRef.current) {
      leafletUserMarkerRef.current.remove();
    }
    leafletUserMarkerRef.current = null;
    currentLeafletPopupRef.current = null;
  };

  useEffect(() => {
    if (!isKakao) {
      resetKakaoArtifacts();
      kakaoMapRef.current = null;
      return undefined;
    }

    let cancelled = false;
    loadKakaoSdk()
      .then(() => {
        if (!cancelled) initKakaoMap();
      })
      .catch((err) => {
        console.error('Kakao Map SDK loading failed:', err);
      });

    return () => {
      cancelled = true;
      resetKakaoArtifacts();
      kakaoMapRef.current = null;
    };
  }, [isKakao]);

  useEffect(() => {
    if (isKakao) {
      resetLeafletArtifacts();
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
      return undefined;
    }

    const container = mapRef.current;
    if (!container) {
      return undefined;
    }

    container.innerHTML = '';
    const mapInstance = L.map(container, {
      zoomControl: true,
      attributionControl: true,
    }).setView([37.5665, 126.9780], 12);

    const tileLayerUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    L.tileLayer(tileLayerUrl, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(mapInstance);

    leafletMapRef.current = mapInstance;
    updateMapMarkers(latestFilteredStoresRef.current);

    return () => {
      resetLeafletArtifacts();
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [isKakao]);

  useEffect(() => {
    filterStores();
    // We intentionally skip filterStores dependency to avoid recreation loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, stores, selectedCategory, sortByDistance, userLocation, isKakao, i18n.language]);

  const categories = [null, ...new Set(stores.map(s => s.category).filter(Boolean))];

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
      alert(t('storeFinder.geolocationNotSupported'));
      return;
    }

    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        setSortByDistance(true);

        // Move map to user location
        if (isKakao && kakaoMapRef.current && window.kakao) {
          const moveLatLon = new window.kakao.maps.LatLng(latitude, longitude);
          kakaoMapRef.current.setCenter(moveLatLon);
          kakaoMapRef.current.setLevel(5); // Level 5 shows approximately 1-2km radius

          // Add user location marker
          if (userMarkerRef.current) {
            userMarkerRef.current.setMap(null);
          }

          const imageSize = new window.kakao.maps.Size(24, 35);
          const markerImage = new window.kakao.maps.MarkerImage(USER_MARKER_ICON, imageSize);

          const marker = new window.kakao.maps.Marker({
            position: moveLatLon,
            image: markerImage,
            title: t('storeFinder.myLocation')
          });

          marker.setMap(kakaoMapRef.current);
          userMarkerRef.current = marker;
        } else if (!isKakao && leafletMapRef.current) {
          const mapInstance = leafletMapRef.current;
          mapInstance.setView([latitude, longitude], 13);

          if (leafletUserMarkerRef.current) {
            leafletUserMarkerRef.current.remove();
          }

          const userIcon = L.icon({
            iconUrl: USER_MARKER_ICON,
            iconSize: [24, 35],
            iconAnchor: [12, 34],
            popupAnchor: [0, -28],
          });

          const marker = L.marker([latitude, longitude], {
            icon: userIcon,
            title: t('storeFinder.myLocation'),
          }).addTo(mapInstance);

          marker.bindPopup(`<strong>${t('storeFinder.myLocation')}</strong>`);
          leafletUserMarkerRef.current = marker;
        }

        setLoadingLocation(false);
      },
      (error) => {
        console.error('Geolocation failed:', error);
        let errorMsg = t('storeFinder.geolocationError');
        if (error.code === 1) {
          errorMsg = t('storeFinder.geolocationDenied');
        } else if (error.code === 2) {
          errorMsg = t('storeFinder.geolocationUnavailable');
        } else if (error.code === 3) {
          errorMsg = t('storeFinder.geolocationTimeout');
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
      console.log('[StoreFinder] Fetching stores from API...');
      const response = await fetch(apiUrl('/api/stores'));
      const data = await response.json();
      console.log('[StoreFinder] ✅ Fetched', data.length, 'stores:', data);

      // Log stores with invalid coordinates
      const invalidStores = data.filter(s => s.lat == null || s.lng == null);
      if (invalidStores.length > 0) {
        console.warn('[StoreFinder] ⚠️ Stores with missing coordinates:', invalidStores);
      }

      setStores(data);
    } catch (error) {
      console.error('[StoreFinder] ❌ Failed to fetch stores:', error);
    }
  };

  const initKakaoMap = () => {
    console.log('[StoreFinder] Initializing Kakao Map...');
    if (!window.kakao || !window.kakao.maps) {
      console.error('[StoreFinder] ❌ Kakao Map API not loaded');
      return;
    }

    window.kakao.maps.load(() => {
      const container = mapRef.current;
      if (!container) {
        console.error('[StoreFinder] ❌ Map container not found');
        return;
      }
      container.innerHTML = '';
      const options = {
        center: new window.kakao.maps.LatLng(37.5665, 126.9780), // Seoul
        level: 6
      };

      kakaoMapRef.current = new window.kakao.maps.Map(container, options);
      console.log('[StoreFinder] ✅ Kakao Map initialized');
      console.log('[StoreFinder] Updating markers with', latestFilteredStoresRef.current.length, 'stores');
      updateMapMarkers(latestFilteredStoresRef.current);
    });
  };

  const updateKakaoMarkers = (storeData) => {
    console.log('[StoreFinder] Updating Kakao markers with', storeData.length, 'stores');

    if (!kakaoMapRef.current || !window.kakao) {
      console.warn('[StoreFinder] ⚠️ Kakao map not ready, skipping marker update');
      return;
    }

    // Clear existing markers
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];
    infowindowsRef.current = [];

    const imageSize = new window.kakao.maps.Size(30, 40);
    const imageOption = { offset: new window.kakao.maps.Point(15, 40) };
    const markerImage = new window.kakao.maps.MarkerImage(STORE_MARKER_ICON, imageSize, imageOption);

    let validMarkers = 0;
    let invalidMarkers = 0;

    storeData.forEach(store => {
      if (store.lat == null || store.lng == null) {
        console.warn('[StoreFinder] ⚠️ Skipping store with invalid coordinates:', store);
        invalidMarkers++;
        return;
      }

      const markerPosition = new window.kakao.maps.LatLng(store.lat, store.lng);
      validMarkers++;

      const storeName = getStoreName(store);
      const storeAddress = getStoreAddress(store);

      const marker = new window.kakao.maps.Marker({
        position: markerPosition,
        image: markerImage,
        title: storeName
      });

      marker.setMap(kakaoMapRef.current);

      const storeCategory = getStoreCategory(store);

      // Create custom overlay content
      const overlayContent = document.createElement('div');
      overlayContent.style.cssText = `
        position: relative;
        padding: 15px;
        width: 250px;
        text-align: center;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        border: 1px solid rgba(148, 163, 184, 0.25);
      `;
      overlayContent.innerHTML = `
        <div style="position: absolute; top: -8px; right: 8px; cursor: pointer; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.1); border-radius: 50%; color: #6b7280; font-weight: bold; font-size: 14px;" id="close-overlay-${store.id}">×</div>
        <h3 style="margin: 0 0 8px 0; color: #1f2937; font-size: 16px; font-weight: 700;">${storeName}</h3>
        <p style="margin: 0 0 5px 0; color: #2563eb; font-size: 14px; font-weight: 600;">${storeCategory}</p>
        <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 12px; line-height: 1.4;">${storeAddress}</p>
        <button
          id="store-detail-btn-${store.id}"
          style="
            padding: 6px 12px;
            background: #f97316;
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
          onmouseover="this.style.background='#ea580c'"
          onmouseout="this.style.background='#f97316'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          ${t('storeFinder.viewDetails')}
        </button>
      `;

      const customOverlay = new window.kakao.maps.CustomOverlay({
        position: markerPosition,
        content: overlayContent,
        yAnchor: 1.4,
        zIndex: 3
      });

      window.kakao.maps.event.addListener(marker, 'click', () => {
        if (currentInfowindowRef.current) {
          if (typeof currentInfowindowRef.current.close === 'function') {
            currentInfowindowRef.current.close();
          } else if (typeof currentInfowindowRef.current.setMap === 'function') {
            currentInfowindowRef.current.setMap(null);
          }
        }

        customOverlay.setMap(kakaoMapRef.current);
        currentInfowindowRef.current = customOverlay;

        setTimeout(() => {
          const closeBtn = document.getElementById(`close-overlay-${store.id}`);
          if (closeBtn) {
            closeBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              customOverlay.setMap(null);
              currentInfowindowRef.current = null;
            };
          }

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
      infowindowsRef.current.push({ storeId: store.id, marker, infowindow: customOverlay });
    });

    console.log('[StoreFinder] ✅ Kakao markers created -', validMarkers, 'valid,', invalidMarkers, 'invalid');

    if (storeData.length > 0 && !sortByDistance) {
      const validStores = storeData.filter(s => s.lat != null && s.lng != null);
      if (validStores.length > 0) {
        const bounds = new window.kakao.maps.LatLngBounds();
        validStores.forEach(store => {
          bounds.extend(new window.kakao.maps.LatLng(store.lat, store.lng));
        });
        kakaoMapRef.current.setBounds(bounds);
        console.log('[StoreFinder] Map bounds adjusted to fit', validStores.length, 'stores');
      }
    }
  };

  const updateLeafletMarkers = (storeData) => {
    console.log('[StoreFinder] Updating Leaflet markers with', storeData.length, 'stores');

    if (!leafletMapRef.current) {
      console.warn('[StoreFinder] ⚠️ Leaflet map not ready, skipping marker update');
      return;
    }

    clearLeafletStoreMarkers();

    const markerIcon = L.icon({
      iconUrl: STORE_MARKER_ICON,
      iconSize: [30, 40],
      iconAnchor: [15, 40],
      popupAnchor: [0, -32],
    });

    let validMarkers = 0;
    let invalidMarkers = 0;

    storeData.forEach(store => {
      if (store.lat == null || store.lng == null) {
        console.warn('[StoreFinder] ⚠️ Skipping store with invalid coordinates:', store);
        invalidMarkers++;
        return;
      }
      validMarkers++;
      const storeName = getStoreName(store);
      const storeAddress = getStoreAddress(store);
      const storeCategory = getStoreCategory(store);

      const marker = L.marker([store.lat, store.lng], {
        icon: markerIcon,
        title: storeName,
      }).addTo(leafletMapRef.current);

      const popupContent = `
        <div style="padding: 15px; width: 250px; text-align: center;">
          <h3 style="margin: 0 0 8px 0; color: #1f2937; font-size: 16px; font-weight: 700;">${storeName}</h3>
          <p style="margin: 0 0 5px 0; color: #2563eb; font-size: 14px; font-weight: 600;">${storeCategory}</p>
          <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 12px; line-height: 1.4;">${storeAddress}</p>
          <button
            id="store-detail-btn-${store.id}"
            style="
              padding: 6px 12px;
              background: #f97316;
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
            onmouseover="this.style.background='#ea580c'"
            onmouseout="this.style.background='#f97316'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            ${t('storeFinder.viewDetails')}
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);

      marker.on('popupopen', () => {
        currentLeafletPopupRef.current = marker.getPopup();
        setTimeout(() => {
          const detailBtn = document.getElementById(`store-detail-btn-${store.id}`);
          if (detailBtn) {
            detailBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              openStoreDetail(store);
            };
          }
        }, 0);
      });

      marker.on('popupclose', () => {
        if (currentLeafletPopupRef.current === marker.getPopup()) {
          currentLeafletPopupRef.current = null;
        }
      });

      leafletMarkersRef.current.push({ storeId: store.id, marker });
    });

    console.log('[StoreFinder] ✅ Leaflet markers created -', validMarkers, 'valid,', invalidMarkers, 'invalid');

    if (storeData.length > 0 && !sortByDistance) {
      const validStores = storeData.filter(s => s.lat != null && s.lng != null);
      if (validStores.length > 0) {
        const bounds = L.latLngBounds(validStores.map(store => [store.lat, store.lng]));
        leafletMapRef.current.fitBounds(bounds, { padding: [40, 40] });
        console.log('[StoreFinder] Map bounds adjusted to fit', validStores.length, 'stores');
      }
    }
  };

  const updateMapMarkers = (storeData) => {
    if (isKakao) {
      updateKakaoMarkers(storeData);
    } else {
      updateLeafletMarkers(storeData);
    }
  };

  const filterStores = () => {
    console.log('[StoreFinder] Filtering stores - Total:', stores.length);
    let filtered = stores;

    // Category filter
    if (selectedCategory !== null) {
      filtered = filtered.filter(store => store.category === selectedCategory);
      console.log('[StoreFinder] After category filter:', filtered.length, 'stores');
    }

    // Search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(store =>
        store.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        store.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        store.address.toLowerCase().includes(searchQuery.toLowerCase())
      );
      console.log('[StoreFinder] After search filter:', filtered.length, 'stores');
    }

    // Add distance and sort if user location is available
    if (sortByDistance && userLocation) {
      filtered = filtered.map(store => ({
        ...store,
        distance: calculateDistance(userLocation.lat, userLocation.lng, store.lat, store.lng)
      })).sort((a, b) => a.distance - b.distance);
      console.log('[StoreFinder] Sorted by distance from user location');
    } else {
      // Default sort: newest first (by id descending)
      filtered = filtered.sort((a, b) => b.id - a.id);
      console.log('[StoreFinder] Sorted by newest first (id descending)');
    }

    console.log('[StoreFinder] Final filtered stores:', filtered.length);
    setFilteredStores(filtered);
    latestFilteredStoresRef.current = filtered;
    updateMapMarkers(filtered);
  };

  const handleStoreClick = (store) => {
    if (isKakao && kakaoMapRef.current && window.kakao) {
      const moveLatLon = new window.kakao.maps.LatLng(store.lat, store.lng);
      kakaoMapRef.current.setCenter(moveLatLon);
      kakaoMapRef.current.setLevel(3); // Zoom in

      // Find and open the corresponding infowindow / overlay
      const storeMarkerData = infowindowsRef.current.find(item => item.storeId === store.id);
      if (storeMarkerData) {
        if (window.kakao?.maps?.event?.trigger) {
          window.kakao.maps.event.trigger(storeMarkerData.marker, 'click');
        } else if (typeof storeMarkerData.infowindow?.open === 'function') {
          if (currentInfowindowRef.current && typeof currentInfowindowRef.current.close === 'function') {
            currentInfowindowRef.current.close();
          }
          storeMarkerData.infowindow.open(kakaoMapRef.current, storeMarkerData.marker);
          currentInfowindowRef.current = storeMarkerData.infowindow;
        } else if (typeof storeMarkerData.infowindow?.setMap === 'function') {
          if (currentInfowindowRef.current && typeof currentInfowindowRef.current.setMap === 'function') {
            currentInfowindowRef.current.setMap(null);
          }
          storeMarkerData.infowindow.setMap(kakaoMapRef.current);
          currentInfowindowRef.current = storeMarkerData.infowindow;
        }
      }
    } else if (!isKakao && leafletMapRef.current) {
      leafletMapRef.current.setView([store.lat, store.lng], 15);
      const storeMarkerData = leafletMarkersRef.current.find(item => item.storeId === store.id);
      if (storeMarkerData) {
        storeMarkerData.marker.openPopup();
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

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      alert(t('common.copied'));
    } catch (err) {
      console.error('Copy failed:', err);
      alert(t('common.copyFailed'));
    }
  };

  const handleDeleteStore = async (store) => {
    if (!store || !store.id) return;
    if (deleteLoadingId) return;
    if (!window.confirm(t('storeFinder.deleteConfirm', { name: store.name }))) return;

    try {
      setDeleteLoadingId(store.id);
      const resp = await fetch(apiUrl(`/api/stores/${store.id}`), {
        method: 'DELETE',
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || t('storeFinder.deleteFailed'));
      }
      await fetchStores();
      if (selectedStore && selectedStore.id === store.id) {
        closeStoreDetail();
      }
    } catch (error) {
      console.error('Failed to delete store:', error);
      alert(error.message || t('storeFinder.deleteFailed'));
    } finally {
      setDeleteLoadingId(null);
    }
  };

  return (
    <>
    <div className="store-finder-page">
    <div className="store-finder">
      <div className="category-filter">
        <label className="category-label" htmlFor="category-select">{t('storeFinder.category')}</label>
        <div className="category-select-wrapper">
          <select
            id="category-select"
            className="category-select"
            value={selectedCategory ?? ''}
            onChange={(e) => setSelectedCategory(e.target.value || null)}
          >
            {categories.map((cat) => (
              <option key={cat ?? ''} value={cat ?? ''}>
                {cat === null ? t('storeFinder.allCategories') : cat}
              </option>
            ))}
          </select>
          <span className="category-select-icon" aria-hidden="true" />
        </div>
      </div>

      <div className="controls">
          <div className="search-container">
            <input
              type="text"
              placeholder={t('storeFinder.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {selectedCategory !== null && (
              <p className="search-hint">{t('storeFinder.searchHint')}</p>
            )}
          </div>
          <button
            type="button"
            onClick={getUserLocation}
            className={`location-btn ${sortByDistance ? 'active' : ''}`}
            disabled={loadingLocation}
          >
            <Icon name="map" size={18} /> {loadingLocation ? t('storeFinder.locating') : sortByDistance ? `${t('storeFinder.nearbyStores')} ✓` : t('storeFinder.nearbyStores')}
          </button>
        </div>

      <div className="store-finder-content">
        <div className="map-container">
          <div ref={mapRef} className="map" />
        </div>

        <div className="store-finder-sidebar">
          <h3 className="sidebar-title">
            {t('storeFinder.storesCount', { count: filteredStores.length })} {sortByDistance && userLocation && t('storeFinder.sortedByDistance')}
          </h3>
          <div className="store-list">
            {filteredStores.map(store => (
              <div
                key={store.id}
                className="store-card"
              >
                <div className="store-card-content">
                  <div className="store-card-header">
                    <h4 className="store-name">{getStoreName(store)}</h4>
                    {sortByDistance && store.distance !== undefined && (
                      <span className="store-distance">{store.distance < 1 ? `${Math.round(store.distance * 1000)}m` : `${store.distance.toFixed(1)}km`}</span>
                    )}
                    <div className="store-card-actions">
                      <button
                        type="button"
                        className="store-action-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStoreClick(store);
                        }}
                        title={t('storeFinder.viewOnMap')}
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
                        title={t('storeFinder.details')}
                      >
                        <Icon name="info" size={18} />
                      </button>
                    </div>
                  </div>
                  <p className="store-address">{getStoreAddress(store)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </div>
    {showDetailModal && selectedStore && (
      <div className="sf-modal-overlay" onClick={closeStoreDetail}>
        <div className="sf-modal" onClick={(e) => e.stopPropagation()}>
          <div className="sf-modal-header">
            <h3>{t('storeFinder.storeInfo')}</h3>
            <button className="sf-modal-close" onClick={closeStoreDetail} aria-label={t('common.close')}>
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="sf-modal-body">
            <div className="store-detail-section">
              <div className="store-detail-header">
                <h2 className="store-detail-name">{getStoreName(selectedStore)}</h2>
                <span className="store-detail-category">{getStoreCategory(selectedStore)}</span>
              </div>
              <div className="store-detail-info">
                <div className="store-detail-item">
                  <Icon name="map" size={18} />
                  <div style={{ flex: 1 }}>
                    <strong>{t('storeFinder.address')}</strong>
                    <p>{getStoreAddress(selectedStore)}</p>
                  </div>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => copyToClipboard(getStoreAddress(selectedStore))}
                    title={t('common.copy')}
                  >
                    <Icon name="copy" size={16} />
                  </button>
                </div>
                {selectedStore.phone && (
                  <div className="store-detail-item">
                    <Icon name="info" size={18} />
                    <div style={{ flex: 1 }}>
                      <strong>{t('storeFinder.phone')}</strong>
                      <p>{selectedStore.phone}</p>
                    </div>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => copyToClipboard(selectedStore.phone)}
                      title={t('common.copy')}
                    >
                      <Icon name="copy" size={16} />
                    </button>
                  </div>
                )}
                {selectedStore.hours && (
                  <div className="store-detail-item">
                    <Icon name="clock" size={18} />
                    <div style={{ flex: 1 }}>
                      <strong>{t('storeFinder.hours')}</strong>
                      <p>{selectedStore.hours}</p>
                    </div>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => copyToClipboard(selectedStore.hours)}
                      title={t('common.copy')}
                    >
                      <Icon name="copy" size={16} />
                    </button>
                  </div>
                )}
                {selectedStore.description && (
                  <div className="store-detail-item">
                    <Icon name="info" size={18} />
                    <div>
                      <strong>{t('storeFinder.description')}</strong>
                      <p>{selectedStore.description}</p>
                    </div>
                  </div>
                )}
                {selectedStore.website && (
                  <div className="store-detail-item">
                    <Icon name="info" size={18} />
                    <div style={{ flex: 1 }}>
                      <strong>{t('storeFinder.website')}</strong>
                      <p>
                        <a href={selectedStore.website} target="_blank" rel="noopener noreferrer" className="store-detail-link">
                          {selectedStore.website}
                        </a>
                      </p>
                    </div>
                  </div>
                )}
                {selectedStore.naver_map_url && (
                  <div className="store-detail-item">
                    <Icon name="map" size={18} />
                    <div style={{ flex: 1 }}>
                      <strong>{t('storeFinder.naverMap')}</strong>
                      <p>
                        <a href={selectedStore.naver_map_url} target="_blank" rel="noopener noreferrer" className="store-detail-link">
                          {t('storeFinder.openInNaverMap')}
                        </a>
                      </p>
                    </div>
                  </div>
                )}
                <div className="store-detail-item">
                  <Icon name="bitcoin" size={18} />
                  <div>
                    <strong>{t('storeFinder.bitcoinPayment')}</strong>
                    <p>{t('storeFinder.bitcoinPaymentDesc')}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="sf-modal-actions">
            <button type="button" className="sf-btn primary" onClick={closeStoreDetail}>{t('common.close')}</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export default StoreFinder;
