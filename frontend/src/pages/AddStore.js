import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiUrl, loadKakaoSdk } from '../config';
import AdminGate from '../components/AdminGate';
import './AddStore.css';

function AddStoreForm() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [submitLoading, setSubmitLoading] = useState(false);
  const isKorean = i18n.language === 'ko';
  const [geocodeStatus, setGeocodeStatus] = useState('idle');

  useEffect(() => {
    document.title = t('pageTitle.addStore');
  }, [t, i18n.language]);
  const createEmptyStore = () => ({
    name: '',
    category: '',
    address: '',
    address_detail: '',
    phone: '',
    hours: '',
    description: '',
    website: '',
    naver_map_url: '',
    lat: null,
    lng: null,
  });
  const [newStore, setNewStore] = useState(createEmptyStore);
  const [hoursRange, setHoursRange] = useState({ open: '', close: '' });
  const geocoderRef = useRef(null);
  const geocodeAbortRef = useRef(null);

  const parseHoursRange = (value = '') => {
    if (!value || typeof value !== 'string') {
      return { open: '', close: '' };
    }
    const parts = value.split(/~|-/).map((part) => part.trim());
    return {
      open: parts[0] || '',
      close: parts[1] || '',
    };
  };

  useEffect(() => {
    const parsed = parseHoursRange(newStore.hours);
    if (parsed.open !== hoursRange.open || parsed.close !== hoursRange.close) {
      setHoursRange(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newStore.hours]);

  const handleHoursChange = (field) => (event) => {
    const value = event.target.value;
    const nextRange = {
      ...hoursRange,
      [field]: value,
    };
    setHoursRange(nextRange);

    setNewStore((prev) => ({
      ...prev,
      hours:
        nextRange.open && nextRange.close
          ? `${nextRange.open} ~ ${nextRange.close}`
          : nextRange.open || nextRange.close
            ? `${nextRange.open}${nextRange.open && !nextRange.close ? ' ~' : ''}${nextRange.close}`
            : '',
    }));
  };

  useEffect(() => {
    console.log('[AddStore] Language changed, isKorean:', isKorean);

    if (!isKorean) {
      console.log('[AddStore] Not Korean language, skipping Kakao SDK');
      geocoderRef.current = null;
      if (geocodeAbortRef.current) {
        geocodeAbortRef.current.abort();
        geocodeAbortRef.current = null;
      }
      return undefined;
    }

    let cancelled = false;
    console.log('[AddStore] Loading Kakao SDK...');

    const initializeGeocoder = () => {
      if (cancelled) {
        console.log('[AddStore] Initialization cancelled');
        return;
      }

      console.log('[AddStore] Checking Kakao availability...');
      console.log('[AddStore] window.kakao:', !!window.kakao);
      console.log('[AddStore] window.kakao.maps:', !!(window.kakao && window.kakao.maps));
      console.log('[AddStore] window.kakao.maps.services:', !!(window.kakao && window.kakao.maps && window.kakao.maps.services));

      if (!window.kakao || !window.kakao.maps) {
        console.error('[AddStore] ❌ Kakao maps not available yet');
        return;
      }

      // Wait for kakao.maps.load to be ready
      if (typeof window.kakao.maps.load !== 'function') {
        console.error('[AddStore] ❌ kakao.maps.load is not a function');
        return;
      }

      console.log('[AddStore] Calling kakao.maps.load...');
      window.kakao.maps.load(() => {
        if (cancelled) {
          console.log('[AddStore] Geocoder init cancelled during load');
          return;
        }

        console.log('[AddStore] Inside kakao.maps.load callback');
        console.log('[AddStore] window.kakao.maps.services:', !!window.kakao.maps.services);

        if (!window.kakao.maps.services) {
          console.error('[AddStore] ❌ services not available even after load');
          return;
        }

        try {
          geocoderRef.current = new window.kakao.maps.services.Geocoder();
          console.log('[AddStore] ✅ Kakao Geocoder initialized successfully');
        } catch (err) {
          console.error('[AddStore] ❌ Failed to create Geocoder:', err);
        }
      });
    };

    loadKakaoSdk()
      .then(() => {
        console.log('[AddStore] Kakao SDK promise resolved');
        // Give a small delay to ensure services are loaded
        setTimeout(() => {
          if (!cancelled) {
            initializeGeocoder();
          }
        }, 100);
      })
      .catch((err) => {
        console.error('[AddStore] Kakao Map SDK loading failed:', err);
      });

    return () => {
      cancelled = true;
      if (geocodeAbortRef.current) {
        geocodeAbortRef.current.abort();
        geocodeAbortRef.current = null;
      }
    };
  }, [isKorean]);

  const geocodeAddress = async (retryCount = 0, addressOverride = null) => {
    const addressQuery = (addressOverride ?? newStore.address ?? '').trim();
    console.log('[Geocode] Starting geocode for address:', addressQuery, 'retry:', retryCount);

    if (!addressQuery) {
      console.log('[Geocode] Empty address, skipping');
      setGeocodeStatus('idle');
      return;
    }

    setGeocodeStatus('loading');

    if (isKorean) {
      console.log('[Geocode] Using Kakao geocoder');

      // Wait for Kakao SDK to be ready
      if (!geocoderRef.current) {
        console.warn('[Geocode] Kakao geocoder not initialized yet, attempting to initialize...');

        // Try to initialize if SDK is loaded but geocoder isn't
        if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
          try {
            await new Promise((resolve) => {
              window.kakao.maps.load(() => {
                geocoderRef.current = new window.kakao.maps.services.Geocoder();
                console.log('[Geocode] Kakao Geocoder initialized on-demand');
                resolve();
              });
            });
          } catch (err) {
            console.error('[Geocode] Failed to initialize Kakao Geocoder:', err);
            setGeocodeStatus('error');
          }
        }

        // Retry after a short delay if still not ready
        if (!geocoderRef.current && retryCount < 3) {
          console.log('[Geocode] Retrying after 500ms... (attempt', retryCount + 1, 'of 3)');
          setTimeout(() => geocodeAddress(retryCount + 1), 500);
          return;
        }

        if (!geocoderRef.current) {
          console.error('[Geocode] ❌ Kakao geocoder still not available after retries');
          setGeocodeStatus('error');
          return;
        }
      }

      console.log('[Geocode] Calling Kakao addressSearch with:', addressQuery);
      geocoderRef.current.addressSearch(addressQuery, (result, status) => {
        console.log('[Geocode] Kakao response - Status:', status, 'Result:', result);

        if (status === window.kakao.maps.services.Status.OK && result && result.length) {
          const { x, y } = result[0];
          const lat = parseFloat(y);
          const lng = parseFloat(x);
          console.log('[Geocode] ✅ Kakao geocoding SUCCESS - Lat:', lat, 'Lng:', lng);
          setNewStore((prev) => ({ ...prev, lat, lng }));
          setGeocodeStatus('success');
        } else {
          console.error('[Geocode] ❌ Kakao geocoding FAILED - Status:', status);
          setGeocodeStatus('error');
        }
      });
      return;
    }

    console.log('[Geocode] Using OpenStreetMap geocoder');
    try {
      if (geocodeAbortRef.current) {
        geocodeAbortRef.current.abort();
      }
      const controller = new AbortController();
      geocodeAbortRef.current = controller;
      const params = new URLSearchParams({
        format: 'json',
        limit: '1',
        addressdetails: '0',
        q: addressQuery,
      });
      const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
      console.log('[Geocode] Fetching from OSM:', url);

      const resp = await fetch(url, {
        headers: {
          'Accept-Language': i18n.language,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      geocodeAbortRef.current = null;

      if (!resp.ok) {
        throw new Error('Geocoding failed');
      }

      const data = await resp.json();
      console.log('[Geocode] OSM response:', data);

      if (Array.isArray(data) && data.length) {
        const { lat, lon } = data[0];
        const parsedLat = parseFloat(lat);
        const parsedLng = parseFloat(lon);
        console.log('[Geocode] ✅ OSM geocoding SUCCESS - Lat:', parsedLat, 'Lng:', parsedLng);
        setNewStore((prev) => ({ ...prev, lat: parsedLat, lng: parsedLng }));
        setGeocodeStatus('success');
      } else {
        console.error('[Geocode] ❌ OSM geocoding FAILED - No results');
        setGeocodeStatus('error');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[Geocode] Request aborted');
        setGeocodeStatus('idle');
        return;
      }
      console.error('[Geocode] ❌ OSM geocoding ERROR:', error);
      setGeocodeStatus('error');
    }
  };

  const openAddressSearch = () => {
    if (!isKorean) {
      const query = newStore.address ? encodeURIComponent(newStore.address) : '';
      window.open(`https://www.openstreetmap.org/search?query=${query}`, '_blank', 'noopener,noreferrer');
      return;
    }

    if (!window.daum) {
      alert(t('messages.addressSearchNotReady'));
      return;
    }
    const openPostcode = () => {
      const postcode = new window.daum.Postcode({
        oncomplete: function(data) {
          const addr = data.roadAddress || data.jibunAddress || '';
          console.log('[AddStore] Daum address selected:', addr);
          if (addr) {
            setNewStore((prev) => ({ ...prev, address: addr, lat: null, lng: null }));
            setGeocodeStatus('loading');
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

  useEffect(() => {
    const normalizedAddress = (newStore.address || '').trim();
    if (!normalizedAddress) {
      setGeocodeStatus('idle');
      return;
    }

    console.log('[AddStore] Address changed, triggering geocode for:', normalizedAddress);
    geocodeAddress(0, normalizedAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newStore.address, isKorean]);

  const submitNewStore = async () => {
    const { name, category, address, phone, hours, description, lat, lng } = newStore;
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    const trimmedAddress = address.trim();
    if (!trimmedName || !trimmedCategory || !trimmedAddress) {
      alert(t('messages.requiredFields'));
      return;
    }
    if (lat == null || lng == null) {
      alert(t('messages.coordinatesRequired'));
      return;
    }
    try {
      setSubmitLoading(true);
      const payload = {
        name: trimmedName,
        category: trimmedCategory,
        address: trimmedAddress,
        address_detail: newStore.address_detail.trim() ? newStore.address_detail.trim() : null,
        lat: Number(lat),
        lng: Number(lng),
        phone: phone.trim() ? phone.trim() : null,
        hours: hours.trim() ? hours.trim() : null,
        description: description.trim() ? description.trim() : null,
        website: newStore.website.trim() ? newStore.website.trim() : null,
        naver_map_url: newStore.naver_map_url.trim() ? newStore.naver_map_url.trim() : null,
      };
      const resp = await fetch(apiUrl('/api/stores'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || t('addStore.error'));
      }
      alert(t('messages.storeSubmitSuccess'));
      navigate('/admin/stores');
    } catch (e) {
      console.error(e);
      alert(e.message || t('messages.storeSubmitError'));
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="add-store-page">
      <div className="add-store-header">
        <h1>{t('addStore.title')}</h1>
        <p className="subtitle">{t('addStore.subtitle')}</p>
      </div>

      <div className="add-store-content">
        <div className="form-section">
          <div className="form-grid">
            <label>
              <span>{t('addStore.storeName')} <span className="required">*</span></span>
              <input
                type="text"
                value={newStore.name}
                onChange={(e) => setNewStore((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('addStore.storeNamePlaceholder')}
              />
            </label>

            <label>
              <span>{t('addStore.category')} <span className="required">*</span></span>
              <input
                type="text"
                value={newStore.category}
                onChange={(e) => setNewStore((prev) => ({ ...prev, category: e.target.value }))}
                placeholder={t('addStore.categoryPlaceholder')}
              />
            </label>

            <label>
              <span>{t('addStore.phone')}</span>
              <input
                type="tel"
                value={newStore.phone}
                onChange={(e) => setNewStore((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder={t('addStore.phonePlaceholder')}
              />
            </label>

            <label>
              <span>{t('addStore.hours')}</span>
              <div className="hours-input-row">
                <input
                  type="time"
                  value={hoursRange.open}
                  onChange={handleHoursChange('open')}
                />
                <span className="hours-separator">~</span>
                <input
                  type="time"
                  value={hoursRange.close}
                  onChange={handleHoursChange('close')}
                />
              </div>
            </label>

            <label className="col-span-2">
              <span>{t('addStore.address')} <span className="required">*</span></span>
              <div className="address-input-row">
                <input
                  type="text"
                  value={newStore.address}
                  readOnly
                  placeholder={t('addStore.addressPlaceholder')}
                  style={{ cursor: 'pointer', backgroundColor: 'var(--surface-bg)' }}
                  onClick={openAddressSearch}
                />
                <button type="button" className="search-btn" onClick={openAddressSearch}>
                  {t('addStore.searchAddress')}
                </button>
              </div>
              {geocodeStatus === 'loading' && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}>
                  {t('addStore.coordinatesLoading')}
                </div>
              )}
              {geocodeStatus === 'success' && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500'
                }}>
                  {t('addStore.coordinatesFound')}
                </div>
              )}
              {geocodeStatus === 'error' && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  borderRadius: '6px',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span>{t('addStore.coordinatesNotFound')}</span>
                  <button
                    type="button"
                    onClick={() => geocodeAddress()}
                    style={{
                      marginLeft: '12px',
                      padding: '4px 12px',
                      backgroundColor: 'white',
                      color: '#ef4444',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    {t('addStore.retryGeocode')}
                  </button>
                </div>
              )}
            </label>

            <label className="col-span-2">
              <span>{t('addStore.addressDetail')}</span>
              <input
                type="text"
                value={newStore.address_detail}
                onChange={(e) => setNewStore((prev) => ({ ...prev, address_detail: e.target.value }))}
                placeholder={t('addStore.addressDetailPlaceholder')}
              />
            </label>

            <label className="col-span-2">
              <span>{t('addStore.description')}</span>
              <textarea
                rows={3}
                value={newStore.description}
                onChange={(e) => setNewStore((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={t('addStore.descriptionPlaceholder')}
              />
            </label>

            <label className="col-span-2">
              <span>{t('addStore.website')}</span>
              <input
                type="url"
                value={newStore.website}
                onChange={(e) => setNewStore((prev) => ({ ...prev, website: e.target.value }))}
                placeholder={t('addStore.websitePlaceholder')}
              />
            </label>

            <label className="col-span-2">
              <span>{t('addStore.naverMapUrl')}</span>
              <input
                type="url"
                value={newStore.naver_map_url}
                onChange={(e) => setNewStore((prev) => ({ ...prev, naver_map_url: e.target.value }))}
                placeholder={t('addStore.naverMapUrlPlaceholder')}
              />
            </label>
          </div>

          <div className="form-actions">
            <button className="cancel-btn" onClick={() => navigate(-1)}>
              {t('common.cancel')}
            </button>
            <button
              className="submit-btn"
              onClick={submitNewStore}
              disabled={submitLoading || geocodeStatus === 'loading'}
            >
              {submitLoading
                ? t('addStore.submitting')
                : geocodeStatus === 'loading'
                  ? t('addStore.coordinatesLoading')
                  : t('addStore.submit')
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddStore() {
  return (
    <AdminGate>
      <AddStoreForm />
    </AdminGate>
  );
}

export default AddStore;
