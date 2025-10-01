// Lightweight Cashu helpers using remote ESM from unpkg (prebuilt)
// - Generates blinded outputs locally
// - Unblinds signatures into spendable proofs

// Prefer esm.sh which serves ESM with proper CORS and dependency resolution
const CASHU_ESM_URL = 'https://esm.sh/@cashu/cashu-ts@2.7.1';

let cashuModPromise = null;
async function loadCashu() {
  if (!cashuModPromise) {
    // Use dynamic import via Function to avoid bundler transforming it
    const dynamicImport = (url) => new Function('u', 'return import(u)')(url);
    cashuModPromise = dynamicImport(CASHU_ESM_URL);
  }
  return cashuModPromise;
}

// Create blinded outputs for a given amount using provided mint keys
export async function createBlindedOutputs(amount, mintKeys) {
  if (!amount || amount <= 0) throw new Error('amount 필요');
  const mod = await loadCashu();
  const { OutputData } = mod;
  const mk = Array.isArray(mintKeys?.keysets) ? mintKeys.keysets[0] : (Array.isArray(mintKeys) ? mintKeys[0] : mintKeys);
  const outputDatas = OutputData.createRandomData(Number(amount), mk);
  const outputs = outputDatas.map(od => od.blindedMessage);
  return { outputDatas, outputs };
}

// Turn signatures (promises) into spendable proofs using previously created output data
export async function signaturesToProofs(signatures, mintKeys, outputDatas) {
  const mod = await loadCashu();
  const mk = Array.isArray(mintKeys?.keysets) ? mintKeys.keysets[0] : (Array.isArray(mintKeys) ? mintKeys[0] : mintKeys);
  const proofs = signatures.map((sig, i) => outputDatas[i].toProof(sig, mk));
  return proofs;
}
