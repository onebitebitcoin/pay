import { useCallback, useEffect, useState } from 'react';

const ADMIN_ACCESS_STORAGE_KEY = 'admin_access_granted';
const ADMIN_PASSWORD = process.env.REACT_APP_ADMIN_PASSWORD || '0000';

const readInitialState = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return localStorage.getItem(ADMIN_ACCESS_STORAGE_KEY) === 'true';
  } catch (error) {
    console.error('[AdminAccess] Failed to read from localStorage:', error);
    return false;
  }
};

export default function useAdminAccess() {
  const [isAuthorized, setIsAuthorized] = useState(readInitialState);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleStorage = (event) => {
      if (event.key === ADMIN_ACCESS_STORAGE_KEY) {
        setIsAuthorized(event.newValue === 'true');
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const authorize = useCallback((password) => {
    if (password === ADMIN_PASSWORD) {
      try {
        localStorage.setItem(ADMIN_ACCESS_STORAGE_KEY, 'true');
      } catch (error) {
        console.error('[AdminAccess] Failed to persist admin access:', error);
      }
      setIsAuthorized(true);
      return true;
    }
    return false;
  }, []);

  const revoke = useCallback(() => {
    try {
      localStorage.removeItem(ADMIN_ACCESS_STORAGE_KEY);
    } catch (error) {
      console.error('[AdminAccess] Failed to clear admin access:', error);
    }
    setIsAuthorized(false);
  }, []);

  return { isAuthorized, authorize, revoke };
}

export { ADMIN_ACCESS_STORAGE_KEY };
