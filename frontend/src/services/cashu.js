// Minimal Cashu client-side storage and helper functions

const STORAGE_KEY = 'cashu_proofs_v1';

export function loadProofs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveProofs(proofs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(proofs || []));
}

function uniqueBySecret(arr) {
  if (!Array.isArray(arr)) return [];
  const map = new Map();
  for (const p of arr) {
    const key = p?.secret || JSON.stringify(p);
    if (!map.has(key)) map.set(key, p);
  }
  return Array.from(map.values());
}

export function getBalanceSats() {
  return uniqueBySecret(loadProofs()).reduce((sum, p) => sum + Number(p?.amount || 0), 0);
}

// Very naive coin selection: pick largest-first until reaching target
export function selectProofsForAmount(target) {
  const proofs = uniqueBySecret(loadProofs()).slice().sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
  const picked = [];
  let total = 0;
  for (const p of proofs) {
    picked.push(p);
    total += Number(p.amount || 0);
    if (total >= target) break;
  }
  if (total < target) return { ok: false, picked: [], total: 0 };
  // Ensure picked is unique
  const uniquePicked = uniqueBySecret(picked);
  return { ok: true, picked: uniquePicked, total: uniquePicked.reduce((s, p) => s + Number(p?.amount || 0), 0) };
}

export function removeProofs(toRemove) {
  const current = loadProofs();
  const set = new Set(toRemove.map((p) => p?.secret || JSON.stringify(p)));
  const remain = current.filter((p) => !set.has(p?.secret || JSON.stringify(p)));
  saveProofs(remain);
}

export function addProofs(newProofs) {
  if (!Array.isArray(newProofs)) return;
  const current = loadProofs();
  const merged = uniqueBySecret([...current, ...newProofs]);
  saveProofs(merged);
}

// Export current proofs as JSON string
export function exportProofsJson(pretty = true) {
  const proofs = loadProofs();
  try {
    return JSON.stringify(proofs, null, pretty ? 2 : 0);
  } catch {
    return '[]';
  }
}

// Import proofs from JSON string or array; merges by unique secret
export function importProofsFrom(any) {
  let arr = any;
  if (typeof any === 'string') {
    try { arr = JSON.parse(any); } catch { arr = []; }
  }
  if (!Array.isArray(arr)) return { added: 0, total: loadProofs().length };
  const existing = loadProofs();
  const bySecret = new Map(existing.map(p => [p?.secret || JSON.stringify(p), p]));
  let added = 0;
  for (const p of arr) {
    const key = p?.secret || JSON.stringify(p);
    if (!bySecret.has(key)) { bySecret.set(key, p); added += 1; }
  }
  saveProofs(Array.from(bySecret.values()));
  return { added, total: bySecret.size };
}
