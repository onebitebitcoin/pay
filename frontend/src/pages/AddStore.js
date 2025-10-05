import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiUrl, loadKakaoSdk } from '../config';
import './AddStore.css';

function AddStore() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [submitLoading, setSubmitLoading] = useState(false);

  useEffect(() => {
    document.title = t('pageTitle.addStore');
  }, [t, i18n.language]);
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
  const geocoderRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadKakaoSdk()
      .then(() => {
        if (!cancelled && window.kakao && window.kakao.maps && window.kakao.maps.services) {
          window.kakao.maps.load(() => {
            geocoderRef.current = new window.kakao.maps.services.Geocoder();
          });
        }
      })
      .catch((err) => {
        console.error('Kakao Map SDK loading failed:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const geocodeAddress = () => {
    if (!geocoderRef.current || !newStore.address) return;
    geocoderRef.current.addressSearch(newStore.address, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result && result.length) {
        const { x, y } = result[0];
        const lat = parseFloat(y);
        const lng = parseFloat(x);
        setNewStore((prev) => ({ ...prev, lat, lng }));
      } else {
        alert(t('messages.addressNotFound'));
      }
    });
  };

  const openAddressSearch = () => {
    if (!window.daum) {
      alert(t('messages.addressSearchNotReady'));
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
      alert(t('messages.requiredFields'));
      return;
    }
    if (lat == null || lng == null) {
      geocodeAddress();
      alert(t('messages.geocoding'));
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
        throw new Error(err.error || t('addStore.error'));
      }
      alert(t('messages.storeSubmitSuccess'));
      navigate('/map');
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
              <input
                type="text"
                value={newStore.hours}
                onChange={(e) => setNewStore((prev) => ({ ...prev, hours: e.target.value }))}
                placeholder={t('addStore.hoursPlaceholder')}
              />
            </label>

            <label className="col-span-2">
              <span>{t('addStore.address')} <span className="required">*</span></span>
              <div className="address-input-row">
                <input
                  type="text"
                  value={newStore.address}
                  onChange={(e) => setNewStore((prev) => ({ ...prev, address: e.target.value, lat: null, lng: null }))}
                  onBlur={geocodeAddress}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); geocodeAddress(); } }}
                  placeholder={t('addStore.addressPlaceholder')}
                />
                <button type="button" className="search-btn" onClick={openAddressSearch}>
                  {t('addStore.searchAddress')}
                </button>
              </div>
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
          </div>

          <div className="form-actions">
            <button className="cancel-btn" onClick={() => navigate(-1)}>
              {t('common.cancel')}
            </button>
            <button className="submit-btn" onClick={submitNewStore} disabled={submitLoading}>
              {submitLoading ? t('addStore.submitting') : t('addStore.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AddStore;
