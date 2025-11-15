/* global BigInt */
// Lightweight Cashu helpers using remote ESM from unpkg (prebuilt)
// - Generates blinded outputs locally
// - Unblinds signatures into spendable proofs

// Prefer esm.sh which serves ESM with proper CORS and dependency resolution
const CASHU_ESM_URL = 'https://esm.sh/@cashu/cashu-ts@2.7.1';

let cashuModPromise = null;
async function loadCashu() {
  if (!cashuModPromise) {
    // Use dynamic import via Function to avoid bundler transforming it
    // eslint-disable-next-line no-new-func
    const dynamicImport = (url) => new Function('u', 'return import(u)')(url);
    cashuModPromise = dynamicImport(CASHU_ESM_URL);
  }
  return cashuModPromise;
}

// Create blinded outputs for a given amount using provided mint keys
export async function createBlindedOutputs(amount, mintKeys) {
  if (!amount || amount <= 0) throw new Error('Amount is required');
  const mod = await loadCashu();
  const { OutputData } = mod;
  const mk = Array.isArray(mintKeys?.keysets) ? mintKeys.keysets[0] : (Array.isArray(mintKeys) ? mintKeys[0] : mintKeys);
  const outputDatas = OutputData.createRandomData(Number(amount), mk);
  const outputs = outputDatas.map(od => od.blindedMessage);
  return { outputDatas, outputs };
}

// Turn signatures (promises) into spendable proofs using previously created output data
export async function signaturesToProofs(signatures, mintKeys, outputDatas) {
  await loadCashu();
  const mk = Array.isArray(mintKeys?.keysets) ? mintKeys.keysets[0] : (Array.isArray(mintKeys) ? mintKeys[0] : mintKeys);
  const proofs = signatures.map((sig, i) => outputDatas[i].toProof(sig, mk));
  return proofs;
}

// Serialize OutputData instances so they can be persisted between sessions
export function serializeOutputDatas(outputDatas) {
  if (!Array.isArray(outputDatas)) return [];
  return outputDatas.map((od) => {
    if (!od) return null;
    const secretArray = od.secret instanceof Uint8Array ? Array.from(od.secret) : [];
    const blindingFactor = typeof od.blindingFactor === 'bigint' ? od.blindingFactor.toString() : (od.blindingFactor ?? '').toString();
    return {
      blindedMessage: od.blindedMessage,
      blindingFactor,
      secret: secretArray,
    };
  }).filter(Boolean);
}

const decodeSecretArray = (value) => {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value === 'string') {
    try {
      if (typeof atob === 'function') {
        const binary = atob(value);
        const arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          arr[i] = binary.charCodeAt(i);
        }
        return arr;
      }
    } catch (e) {
      console.warn('Failed to decode secret string', e);
    }
  }
  return new Uint8Array();
};

const ensureBigInt = (value) => {
  if (typeof value === 'bigint') return value;
  if (typeof BigInt !== 'function') {
    throw new Error('BigInt not supported in this environment');
  }
  return BigInt(value);
};

export async function deserializeOutputDatas(serialized) {
  if (!Array.isArray(serialized) || serialized.length === 0) return [];
  const mod = await loadCashu();
  const { OutputData } = mod;
  return serialized.map((item) => {
    try {
      if (!item?.blindedMessage || item?.blindingFactor === undefined || item?.secret === undefined) {
        return null;
      }
      const factor = ensureBigInt(item.blindingFactor);
      const secret = decodeSecretArray(item.secret);
      return new OutputData(item.blindedMessage, factor, secret);
    } catch (e) {
      console.warn('Failed to deserialize OutputData', e);
      return null;
    }
  }).filter(Boolean);
}
