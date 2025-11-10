import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useAdminAccess from '../hooks/useAdminAccess';
import './AdminGate.css';

function AdminGate({ children }) {
  const { t } = useTranslation();
  const { isAuthorized, authorize } = useAdminAccess();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();
    if (authorize(password)) {
      setPassword('');
      setError('');
      return;
    }
    setError(t('adminAccess.invalidPassword'));
  };

  if (isAuthorized) {
    return <>{children}</>;
  }

  return (
    <section className="admin-gate">
      <h1>{t('adminAccess.title')}</h1>
      <p>{t('adminAccess.description')}</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError('');
          }}
          placeholder={t('adminAccess.placeholder')}
          autoFocus
        />
        {error && <div className="admin-gate-error">{error}</div>}
        <button type="submit">
          {t('adminAccess.submit')}
        </button>
      </form>
    </section>
  );
}

export default AdminGate;
