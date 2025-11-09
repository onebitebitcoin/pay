import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import AdminGate from '../components/AdminGate';
import Icon from '../components/Icon';
import { apiUrl, loadKakaoSdk } from '../config';
import './StoreManagement.css';

const emptyForm = {
  name: '',
  category: '',
  address: '',
  lat: '',
  lng: '',
  phone: '',
  hours: '',
  description: '',
  website: '',
};

function StoreManagementContent() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [reloadIndex, setReloadIndex] = useState(0);
  const [editingStoreId, setEditingStoreId] = useState(null);
  const [formValues, setFormValues] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [status, setStatus] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editHoursRange, setEditHoursRange] = useState({ open: '', close: '' });
  const [geocodeStatus, setGeocodeStatus] = useState('idle');
  const geocoderRef = useRef(null);

  // Filter and pagination states
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest'); // 'newest' or 'oldest'
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  useEffect(() => {
    document.title = t('pageTitle.storeManagement');
  }, [t, i18n.language]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const fetchStores = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(apiUrl('/api/stores'), { signal: controller.signal });
        if (!response.ok) {
          throw new Error('Failed to fetch stores');
        }
        const data = await response.json();
        if (!cancelled) {
          setStores(Array.isArray(data) ? data : []);
          setLastUpdated(new Date());
        }
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }
        console.error('[StoreManagement] Failed to load stores:', fetchError);
        if (!cancelled) {
          setError(t('storeManagementPage.loadError'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchStores();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadIndex, t]);

  // Reload stores when returning to this page
  useEffect(() => {
    if (location.pathname === '/admin/stores') {
      setReloadIndex((prev) => prev + 1);
    }
  }, [location.pathname]);

  // Reload stores when page becomes visible (e.g., switching tabs)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && location.pathname === '/admin/stores') {
        setReloadIndex((prev) => prev + 1);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [location.pathname]);

  // Load Kakao SDK for address search (Korean only)
  useEffect(() => {
    const isKorean = i18n.language === 'ko';
    if (!isKorean) {
      geocoderRef.current = null;
      return;
    }

    loadKakaoSdk()
      .then(() => {
        console.log('[StoreManagement] Kakao SDK loaded successfully');
        if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
          geocoderRef.current = new window.kakao.maps.services.Geocoder();
          console.log('[StoreManagement] Kakao Geocoder initialized');
        }
      })
      .catch((err) => {
        console.error('[StoreManagement] Failed to load Kakao SDK:', err);
      });
  }, [i18n.language]);

  // Get unique categories
  const categories = useMemo(() => {
    const uniqueCategories = new Set();
    stores.forEach(store => {
      if (store.category) {
        uniqueCategories.add(store.category);
      }
    });
    return Array.from(uniqueCategories).sort();
  }, [stores]);

  // Filter and sort stores
  const filteredAndSortedStores = useMemo(() => {
    let result = [...stores];

    // Filter by search term
    if (searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(store =>
        (store.name || '').toLowerCase().includes(lowerSearch) ||
        (store.address || '').toLowerCase().includes(lowerSearch)
      );
    }

    // Filter by category
    if (categoryFilter !== 'all') {
      result = result.filter(store => store.category === categoryFilter);
    }

    // Sort by ID (newest or oldest)
    result.sort((a, b) => {
      if (sortOrder === 'newest') {
        return (b.id || 0) - (a.id || 0);
      } else {
        return (a.id || 0) - (b.id || 0);
      }
    });

    return result;
  }, [stores, searchTerm, categoryFilter, sortOrder]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedStores.length / itemsPerPage);
  const paginatedStores = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredAndSortedStores.slice(startIndex, endIndex);
  }, [filteredAndSortedStores, currentPage, itemsPerPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter, sortOrder, itemsPerPage]);

  const editingStore = useMemo(
    () => stores.find((store) => store.id === editingStoreId) || null,
    [stores, editingStoreId]
  );

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
    if (editingStore) {
      setFormValues({
        name: editingStore.name || '',
        category: editingStore.category || '',
        address: editingStore.address || '',
        lat: editingStore.lat ?? '',
        lng: editingStore.lng ?? '',
        phone: editingStore.phone || '',
        hours: editingStore.hours || '',
        description: editingStore.description || '',
      });
      setEditHoursRange(parseHoursRange(editingStore.hours));
    } else {
      setFormValues(emptyForm);
      setEditHoursRange({ open: '', close: '' });
    }
  }, [editingStore]);

  const handleEditClick = (store) => {
    setEditingStoreId(store.id);
    setStatus(null);
    setEditModalOpen(true);
  };

  const handleCloseEdit = () => {
    setEditingStoreId(null);
    setFormValues(emptyForm);
    setStatus(null);
    setEditModalOpen(false);
    setEditHoursRange({ open: '', close: '' });
  };

  const handleInputChange = (field) => (event) => {
    const { value } = event.target;
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleHoursInputChange = (field) => (event) => {
    const value = event.target.value;
    const nextRange = { ...editHoursRange, [field]: value };
    setEditHoursRange(nextRange);
    setFormValues((prev) => ({
      ...prev,
      hours:
        nextRange.open && nextRange.close
          ? `${nextRange.open} ~ ${nextRange.close}`
          : nextRange.open || nextRange.close
            ? `${nextRange.open}${nextRange.open && !nextRange.close ? ' ~' : ''}${nextRange.close}`
            : '',
    }));
  };

  const geocodeAddress = async () => {
    const addressQuery = (formValues.address || '').trim();
    if (!addressQuery) {
      return;
    }

    const isKorean = i18n.language === 'ko';

    if (isKorean && geocoderRef.current) {
      console.log('[StoreManagement] Using Kakao geocoder for:', addressQuery);
      setGeocodeStatus('loading');
      geocoderRef.current.addressSearch(addressQuery, (result, status) => {
        if (status === window.kakao.maps.services.Status.OK && result.length > 0) {
          const { y: lat, x: lng } = result[0];
          const parsedLat = parseFloat(lat);
          const parsedLng = parseFloat(lng);
          console.log('[StoreManagement] Kakao geocoding SUCCESS - Lat:', parsedLat, 'Lng:', parsedLng);
          setFormValues((prev) => ({ ...prev, lat: parsedLat, lng: parsedLng }));
          setGeocodeStatus('success');
        } else {
          console.error('[StoreManagement] Kakao geocoding FAILED - Status:', status);
          setGeocodeStatus('error');
        }
      });
    }
  };

  const openAddressSearch = () => {
    const isKorean = i18n.language === 'ko';

    if (!isKorean) {
      const query = formValues.address ? encodeURIComponent(formValues.address) : '';
      window.open(`https://www.openstreetmap.org/search?query=${query}`, '_blank', 'noopener,noreferrer');
      return;
    }

    if (!window.daum) {
      alert(t('messages.addressSearchNotReady'));
      return;
    }

    const postcode = new window.daum.Postcode({
      oncomplete: function(data) {
        const addr = data.roadAddress || data.jibunAddress || '';
        console.log('[StoreManagement] Daum address selected:', addr);
        if (addr) {
          setFormValues((prev) => ({ ...prev, address: addr }));
          setGeocodeStatus('loading');
          setTimeout(() => {
            geocodeAddress();
          }, 300);
        }
      }
    });
    postcode.open();
  };

  const handleDeleteStore = async (store) => {
    if (deletingId || saving) return;
    const confirmed = window.confirm(
      t('storeManagementPage.deleteConfirm', {
        name: store.name || t('storeManagementPage.fields.unnamed'),
      })
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(store.id);
    setStatus(null);
    try {
      const response = await fetch(apiUrl(`/api/stores/${store.id}`), {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete store');
      }
      setStores((prev) => prev.filter((s) => s.id !== store.id));
      if (editingStoreId === store.id) {
        handleCloseEdit();
      }
      setLastUpdated(new Date());
      setStatus({ type: 'success', message: t('storeManagementPage.deleteSuccess') });
    } catch (deleteError) {
      console.error('[StoreManagement] Failed to delete store:', deleteError);
      setStatus({ type: 'error', message: t('storeManagementPage.deleteError') });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveStore = async () => {
    if (!editingStoreId || saving) {
      return;
    }

    const trimmedName = formValues.name.trim();
    const trimmedCategory = formValues.category.trim();
    const trimmedAddress = formValues.address.trim();
    const nextLat = parseFloat(formValues.lat);
    const nextLng = parseFloat(formValues.lng);

    if (
      !trimmedName ||
      !trimmedCategory ||
      !trimmedAddress ||
      !Number.isFinite(nextLat) ||
      !Number.isFinite(nextLng)
    ) {
      setStatus({ type: 'error', message: t('storeManagementPage.validationError') });
      return;
    }

    setSaving(true);
    setStatus(null);

    try {
      const payload = {
        name: trimmedName,
        category: trimmedCategory,
        address: trimmedAddress,
        lat: nextLat,
        lng: nextLng,
        phone: formValues.phone.trim() || null,
        hours: formValues.hours.trim() || null,
        description: formValues.description.trim() || null,
      };

      const response = await fetch(apiUrl(`/api/stores/${editingStoreId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to update store');
      }

      const updated = await response.json();
      setStores((prev) => prev.map((store) => (store.id === updated.id ? updated : store)));
      setLastUpdated(new Date());
      setStatus({ type: 'success', message: t('storeManagementPage.updateSuccess') });
      handleCloseEdit();
    } catch (updateError) {
      console.error('[StoreManagement] Failed to update store:', updateError);
      setStatus({ type: 'error', message: t('storeManagementPage.updateError') });
    } finally {
      setSaving(false);
    }
  };

  const renderContent = () => {
    if (loading) {
      return <div className="store-management-state">{t('storeManagementPage.loading')}</div>;
    }

    if (error) {
      return (
        <div className="store-management-state error">
          <p>{error}</p>
          <button type="button" onClick={() => setReloadIndex((prev) => prev + 1)}>
            {t('storeManagementPage.refresh')}
          </button>
        </div>
      );
    }

    if (stores.length === 0) {
      return <div className="store-management-state">{t('storeManagementPage.noStores')}</div>;
    }

    if (filteredAndSortedStores.length === 0) {
      return <div className="store-management-state">{t('storeManagementPage.noResults')}</div>;
    }

    return (
      <>
        <div className="store-management-table-wrapper">
          <table className="store-management-table">
            <thead>
              <tr>
                <th>{t('storeManagementPage.table.id')}</th>
                <th>{t('storeManagementPage.table.name')}</th>
                <th>{t('storeManagementPage.table.category')}</th>
                <th>{t('storeManagementPage.table.address')}</th>
                <th>{t('storeManagementPage.table.phone')}</th>
                <th>{t('storeManagementPage.table.hours')}</th>
                <th>{t('storeManagementPage.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedStores.map((store) => (
                <tr
                  key={store.id}
                  className={editingStoreId === store.id ? 'active' : undefined}
                >
                  <td>#{store.id}</td>
                  <td>{store.name || t('storeManagementPage.fields.unnamed')}</td>
                  <td>{store.category || t('storeManagementPage.fields.uncategorized')}</td>
                  <td>{store.address || t('storeManagementPage.notAvailable')}</td>
                  <td>{store.phone || t('storeManagementPage.notAvailable')}</td>
                  <td>{store.hours || t('storeManagementPage.notAvailable')}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="table-icon-button"
                        onClick={() => handleEditClick(store)}
                        aria-label={t('storeManagementPage.actions.edit')}
                      >
                        <Icon name="edit" size={16} />
                      </button>
                      <button
                        type="button"
                        className="table-icon-button danger"
                        onClick={() => handleDeleteStore(store)}
                        disabled={deletingId === store.id}
                        aria-label={
                          deletingId === store.id
                            ? t('storeManagementPage.actions.deleting')
                            : t('storeManagementPage.actions.delete')
                        }
                      >
                        {deletingId === store.id ? (
                          <Icon name="loader" size={16} className="spin" />
                        ) : (
                          <Icon name="trash" size={16} />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              {t('storeManagementPage.pagination.first')}
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              {t('storeManagementPage.pagination.prev')}
            </button>

            <div className="pagination-info">
              {t('storeManagementPage.pagination.pageOf', { current: currentPage, total: totalPages })}
            </div>

            <button
              className="pagination-btn"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              {t('storeManagementPage.pagination.next')}
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              {t('storeManagementPage.pagination.last')}
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="store-management-page">
      <div className="store-management-header">
        <div>
          <p className="store-management-eyebrow">{t('storeManagementPage.eyebrow')}</p>
          <h1>{t('storeManagementPage.title')}</h1>
          <p className="store-management-subtitle">{t('storeManagementPage.subtitle')}</p>
        </div>
        <div className="store-management-actions">
          <button
            type="button"
            className="icon-button ghost"
            onClick={() => setReloadIndex((prev) => prev + 1)}
            aria-label={t('storeManagementPage.refresh')}
          >
            <Icon name="refresh" size={18} />
            <span className="sr-only">{t('storeManagementPage.refresh')}</span>
          </button>
          <button
            type="button"
            className="icon-button primary"
            onClick={() => navigate('/admin/stores/add')}
            aria-label={t('storeManagementPage.addStore')}
          >
            <Icon name="plus" size={20} />
            <span className="sr-only">{t('storeManagementPage.addStore')}</span>
          </button>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="store-filters">
        <div className="filter-row">
          <div className="filter-group">
            <label htmlFor="search-store">{t('storeManagementPage.filters.search')}</label>
            <input
              id="search-store"
              type="text"
              placeholder={t('storeManagementPage.filters.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="filter-input"
            />
          </div>

          <div className="filter-group">
            <label htmlFor="category-filter">{t('storeManagementPage.filters.category')}</label>
            <select
              id="category-filter"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">{t('storeManagementPage.filters.allCategories')}</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label htmlFor="sort-order">{t('storeManagementPage.filters.sort')}</label>
            <select
              id="sort-order"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="filter-select"
            >
              <option value="newest">{t('storeManagementPage.filters.newest')}</option>
              <option value="oldest">{t('storeManagementPage.filters.oldest')}</option>
            </select>
          </div>

          <div className="filter-group">
            <label htmlFor="items-per-page">{t('storeManagementPage.filters.perPage')}</label>
            <select
              id="items-per-page"
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="filter-select"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        <div className="filter-summary">
          {t('storeManagementPage.filters.showing', {
            start: filteredAndSortedStores.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1,
            end: Math.min(currentPage * itemsPerPage, filteredAndSortedStores.length),
            total: filteredAndSortedStores.length,
            totalStores: stores.length
          })}
        </div>
      </div>

      <div className="store-management-summary">
        <div className="summary-pill">
          <p className="summary-label">{t('storeManagementPage.summary.total')}</p>
          <p className="summary-value">
            {t('storeManagementPage.totalStores', { count: stores.length })}
          </p>
        </div>
        {lastUpdated && (
          <div className="summary-pill">
            <p className="summary-label">{t('storeManagementPage.summary.updated')}</p>
            <p className="summary-value">
              {t('storeManagementPage.lastUpdated', {
                value: lastUpdated.toLocaleString(i18n.language),
              })}
            </p>
          </div>
        )}
      </div>

      {status && (
        <div className={`store-management-status ${status.type}`}>
          {status.message}
        </div>
      )}

      {renderContent()}

      {editModalOpen && editingStoreId && (
        <div className="store-edit-modal">
          <div className="store-edit-dialog">
            <div className="edit-panel-header">
              <div>
                <p className="panel-eyebrow">{t('storeManagementPage.editPanel.title')}</p>
                <h2>{t('storeManagementPage.editPanel.subtitle')}</h2>
                <p className="panel-hint">{t('storeManagementPage.editPanel.coordinatesHint')}</p>
              </div>
            </div>
            <div className="edit-form-grid">
              <label>
                <span>{t('addStore.storeName')}</span>
                <input
                  type="text"
                  value={formValues.name}
                  onChange={handleInputChange('name')}
                />
              </label>
              <label>
                <span>{t('addStore.category')}</span>
                <input
                  type="text"
                  value={formValues.category}
                  onChange={handleInputChange('category')}
                />
              </label>
              <label className="full-width">
                <span>{t('addStore.address')}</span>
                <div className="address-input-row" style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={formValues.address}
                    readOnly
                    placeholder={t('addStore.addressPlaceholder')}
                    style={{ flex: 1, cursor: 'pointer', backgroundColor: 'var(--surface-bg)' }}
                    onClick={openAddressSearch}
                  />
                  <button
                    type="button"
                    className="search-btn"
                    onClick={openAddressSearch}
                    style={{
                      padding: '0.65rem 1rem',
                      borderRadius: '8px',
                      border: '2px solid var(--border)',
                      background: 'var(--primary)',
                      color: 'white',
                      fontWeight: '600',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
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
                    fontSize: '14px'
                  }}>
                    {t('addStore.coordinatesNotFound')}
                  </div>
                )}
              </label>
              <label>
                <span>{t('addStore.phone')}</span>
                <input
                  type="text"
                  value={formValues.phone}
                  onChange={handleInputChange('phone')}
                />
              </label>
              <label className="full-width">
                <span>{t('addStore.hours')}</span>
                <div className="hours-input-row">
                  <input
                    type="time"
                    value={editHoursRange.open}
                    onChange={handleHoursInputChange('open')}
                  />
                  <span className="hours-separator">~</span>
                  <input
                    type="time"
                    value={editHoursRange.close}
                    onChange={handleHoursInputChange('close')}
                  />
                </div>
              </label>
              <label className="full-width">
                <span>{t('addStore.description')}</span>
                <textarea
                  rows={3}
                  value={formValues.description}
                  onChange={handleInputChange('description')}
                />
              </label>

              <label className="full-width">
                <span>{t('addStore.website')}</span>
                <input
                  type="url"
                  value={formValues.website}
                  onChange={handleInputChange('website')}
                  placeholder={t('addStore.websitePlaceholder')}
                />
              </label>
            </div>
            <div className="edit-panel-actions">
              <button className="ghost" type="button" onClick={handleCloseEdit}>
                {t('storeManagementPage.actions.cancel')}
              </button>
              <button
                className="primary"
                type="button"
                onClick={handleSaveStore}
                disabled={saving}
              >
                {saving
                  ? t('storeManagementPage.actions.saving')
                  : t('storeManagementPage.actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StoreManagement() {
  return (
    <AdminGate>
      <StoreManagementContent />
    </AdminGate>
  );
}

export default StoreManagement;
