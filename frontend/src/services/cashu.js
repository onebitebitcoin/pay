// Minimal Cashu client-side storage and helper functions

const STORAGE_KEY = 'cashu_proofs_v2'; // Updated to v2 for mint URL support

export function loadProofs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);

    // Handle legacy format (array of proofs without mint URL)
    if (Array.isArray(data)) {
      return data.map(p => ({
        ...p,
        mintUrl: p.mintUrl || process.env.REACT_APP_MINT_URL || 'https://mint.minibits.cash/Bitcoin'
      }));
    }

    // New format: { proofs: [...], mintUrl: '...' }
    return data.proofs || [];
  } catch {
    return [];
  }
}

export function saveProofs(proofs, mintUrl) {
  // Each proof should have its mint URL
  const proofsWithMint = proofs.map(p => ({
    ...p,
    mintUrl: p.mintUrl || mintUrl || process.env.REACT_APP_MINT_URL || 'https://mint.minibits.cash/Bitcoin'
  }));

  localStorage.setItem(STORAGE_KEY, JSON.stringify(proofsWithMint));
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

export function removeProofs(toRemove, mintUrl) {
  const current = loadProofs();
  const set = new Set(toRemove.map((p) => p?.secret || JSON.stringify(p)));
  const remain = current.filter((p) => !set.has(p?.secret || JSON.stringify(p)));
  saveProofs(remain, mintUrl);
}

export function addProofs(newProofs, mintUrl) {
  if (!Array.isArray(newProofs)) return;
  const current = loadProofs();

  // Add mint URL to new proofs
  const proofsWithMint = newProofs.map(p => ({
    ...p,
    mintUrl: p.mintUrl || mintUrl || process.env.REACT_APP_MINT_URL || 'https://mint.minibits.cash/Bitcoin'
  }));

  const merged = uniqueBySecret([...current, ...proofsWithMint]);
  saveProofs(merged, mintUrl);
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

// Verify proofs against Mint server and remove spent ones
export async function syncProofsWithMint(apiBaseUrl, mintUrl) {
  const proofs = loadProofs();
  if (proofs.length === 0) return { removed: 0, remaining: 0 };

  try {
    const url = `${apiBaseUrl}/api/cashu/check`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proofs, mintUrl })
    });

    if (!response.ok) {
      console.error('Proof check failed:', response.status);
      return { removed: 0, remaining: proofs.length };
    }

    const result = await response.json();
    const states = result?.states || [];

    // Build map of Y -> state
    const stateMap = new Map();
    for (const s of states) {
      if (s?.Y && s?.state) {
        stateMap.set(s.Y, s.state);
      }
    }

    // Filter out spent proofs
    const validProofs = [];
    const spentProofs = [];

    for (const p of proofs) {
      const Y = p?.Y || p?.C;
      const state = stateMap.get(Y);

      if (state === 'SPENT') {
        spentProofs.push(p);
      } else {
        validProofs.push(p);
      }
    }

    // Save only valid proofs
    if (spentProofs.length > 0) {
      saveProofs(validProofs, apiBaseUrl);
      console.log(`Removed ${spentProofs.length} spent proofs`);
    }

    return {
      removed: spentProofs.length,
      remaining: validProofs.length
    };
  } catch (error) {
    console.error('Sync error:', error);
    return { removed: 0, remaining: proofs.length };
  }
}

// Swap all proofs for fresh ones (refresh proofs)
export async function refreshProofs(apiBaseUrl, createBlindedOutputsFn, signaturesToProofsFn, mintUrl) {
  const proofs = loadProofs();
  if (proofs.length === 0) return { success: false, error: '새로고침할 토큰이 없습니다' };

  try {
    // Get total amount
    const totalAmount = proofs.reduce((sum, p) => sum + Number(p?.amount || 0), 0);

    // Get mint keys
    const keysResp = await fetch(`${apiBaseUrl}/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl || '')}`);
    if (!keysResp.ok) throw new Error('Mint 키 조회 실패');
    const mintKeys = await keysResp.json();

    // Create new blinded outputs for the same amount
    const { outputs, outputDatas } = await createBlindedOutputsFn(totalAmount, mintKeys);

    // Swap old proofs for new ones
    const swapResp = await fetch(`${apiBaseUrl}/api/cashu/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: proofs,
        outputs,
        mintUrl
      })
    });

    if (!swapResp.ok) {
      const err = await swapResp.json();
      throw new Error(err?.error || 'Swap 실패');
    }

    const swapResult = await swapResp.json();
    const signatures = swapResult?.signatures || swapResult?.promises || [];

    if (!Array.isArray(signatures) || signatures.length === 0) {
      throw new Error('Swap 응답에서 서명을 받지 못했습니다');
    }

    // Convert signatures to proofs
    const newProofs = await signaturesToProofsFn(signatures, mintKeys, outputDatas);

    // Replace old proofs with new ones
    saveProofs(newProofs, apiBaseUrl);

    return {
      success: true,
      oldCount: proofs.length,
      newCount: newProofs.length,
      amount: totalAmount
    };
  } catch (error) {
    console.error('Refresh proofs error:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error'
    };
  }
}
