const DEFAULT_THEME = 'dark';
const VALID_THEMES = ['light', 'dark'];

const normalizeTheme = (theme) => {
  if (typeof theme !== 'string') {
    return DEFAULT_THEME;
  }
  const normalized = theme.toLowerCase();
  return VALID_THEMES.includes(normalized) ? normalized : DEFAULT_THEME;
};

export const getStoredTheme = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME;
  }

  try {
    const saved = window.localStorage.getItem('app_settings');
    if (!saved) {
      return DEFAULT_THEME;
    }

    const parsed = JSON.parse(saved);
    if (parsed && parsed.theme) {
      return normalizeTheme(parsed.theme);
    }
  } catch (error) {
    console.error('Failed to read stored theme', error);
  }

  return DEFAULT_THEME;
};

export const applyTheme = (theme) => {
  if (typeof document === 'undefined') {
    return;
  }

  const normalized = normalizeTheme(theme);
  const root = document.documentElement;

  root.classList.remove('light', 'dark');
  root.classList.add(normalized);
  root.setAttribute('data-theme', normalized);
  root.style.colorScheme = normalized;
};

export const updateStoredTheme = (theme) => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeTheme(theme);

  try {
    const saved = window.localStorage.getItem('app_settings');
    if (!saved) {
      window.localStorage.setItem('app_settings', JSON.stringify({ theme: normalized }));
      return;
    }

    const parsed = JSON.parse(saved) || {};
    const nextSettings = { ...parsed, theme: normalized };
    window.localStorage.setItem('app_settings', JSON.stringify(nextSettings));
  } catch (error) {
    console.error('Failed to persist theme', error);
  }
};

export { DEFAULT_THEME, VALID_THEMES, normalizeTheme };
