import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import AdminGate from '../components/AdminGate';
import Icon from '../components/Icon';
import { apiUrl } from '../config';
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

  const sortedStores = useMemo(() => {
    return [...stores].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [stores]);

  const editingStore = useMemo(
    () => sortedStores.find((store) => store.id === editingStoreId) || null,
    [sortedStores, editingStoreId]
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

    if (!sortedStores.length) {
      return <div className="store-management-state">{t('storeManagementPage.noStores')}</div>;
    }

    return (
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
            {sortedStores.map((store) => (
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
                <input
                  type="text"
                  value={formValues.address}
                  onChange={handleInputChange('address')}
                />
              </label>
              <label>
                <span>{t('addStore.latitude')}</span>
                <input
                  type="number"
                  value={formValues.lat}
                  onChange={handleInputChange('lat')}
                  step="0.0000001"
                />
              </label>
              <label>
                <span>{t('addStore.longitude')}</span>
                <input
                  type="number"
                  value={formValues.lng}
                  onChange={handleInputChange('lng')}
                  step="0.0000001"
                />
              </label>
              <label>
                <span>{t('addStore.phone')}</span>
                <input
                  type="text"
                  value={formValues.phone}
                  onChange={handleInputChange('phone')}
                />
              </label>
              <label>
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
