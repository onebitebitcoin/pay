import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QrScannerLib from 'qr-scanner';

function QrScanner({ onScan, onError, className = '' }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const imageCaptureRef = useRef(null);
  const photoCapabilitiesRef = useRef(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [focusSupported, setFocusSupported] = useState(false);
  const [enhancingCamera, setEnhancingCamera] = useState(false);

  const normalizeModes = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
  };

  const getMacroFocusValue = (range = {}) => {
    const { min = 0, max = 1 } = range;
    const delta = max - min;
    if (!Number.isFinite(delta) || delta <= 0) {
      return min;
    }
    // bias heavily towards macro (closest focus distance)
    return Math.max(min, Math.min(max, min + delta * 0.03));
  };

  const appendTrackFocusConstraints = (capabilities = {}, advanced = []) => {
    const focusModes = normalizeModes(capabilities.focusMode);
    const supportsManual = focusModes.includes('manual') && capabilities.focusDistance;
    if (supportsManual) {
      advanced.push({
        focusMode: 'manual',
        focusDistance: getMacroFocusValue(capabilities.focusDistance)
      });
      return true;
    }

    if (focusModes.includes('continuous') || focusModes.includes('auto')) {
      advanced.push({
        focusMode: focusModes.includes('continuous') ? 'continuous' : 'auto'
      });
      return true;
    }

    if (focusModes.includes('single-shot')) {
      advanced.push({ focusMode: 'single-shot' });
      return true;
    }

    return false;
  };

  const applyPhotoFocusOptions = async (imageCapture, photoCaps) => {
    if (!imageCapture || !photoCaps) return false;
    const focusModes = normalizeModes(photoCaps.focusMode);

    if (focusModes.includes('manual') && photoCaps.focusDistance) {
      await imageCapture.setOptions({
        focusMode: 'manual',
        focusDistance: getMacroFocusValue(photoCaps.focusDistance)
      });
      return true;
    }

    if (focusModes.includes('continuous')) {
      await imageCapture.setOptions({ focusMode: 'continuous' });
      return true;
    }

    if (focusModes.includes('single-shot')) {
      await imageCapture.setOptions({ focusMode: 'single-shot' });
      return true;
    }

    return false;
  };

  useEffect(() => {
    let scanner = null;
    let cancelled = false;

    async function startScanner() {
      try {
        if (!videoRef.current) return;

        // Create scanner instance
        scanner = new QrScannerLib(
          videoRef.current,
          (result) => {
            // Success callback
            if (result && typeof onScan === 'function') {
              onScan(result.data.trim());
              // Stop scanner after successful scan
              if (scanner) {
                scanner.stop();
              }
            }
          },
          {
            // Maximum performance scanning settings
            returnDetailedScanResult: true,
            highlightScanRegion: false,
            highlightCodeOutline: false,
            maxScansPerSecond: 60,
            preferredCamera: 'environment',
            calculateScanRegion: (video) => {
              // Use a very large scan region (95% of shorter side) for maximum sensitivity
              const smallestDimension = Math.min(video.videoWidth, video.videoHeight);
              const scanRegionSize = Math.round(0.95 * smallestDimension);
              return {
                x: Math.round((video.videoWidth - scanRegionSize) / 2),
                y: Math.round((video.videoHeight - scanRegionSize) / 2),
                width: scanRegionSize,
                height: scanRegionSize,
              };
            }
          }
        );

        scannerRef.current = scanner;

        // Enable inversion mode to scan both normal and inverted QR codes
        // This significantly improves recognition rate
        scanner.setInversionMode('both');

        // Start scanning with maximum quality camera constraints
        // Request highest possible resolution and frame rate for crisp QR scanning
        // Don't set focusMode here - will be optimized after camera starts
        const constraints = {
          facingMode: 'environment',
          width: { ideal: 2560, max: 4096, min: 1920 },
          height: { ideal: 1440, max: 2160, min: 1080 },
          frameRate: { ideal: 60, max: 60, min: 30 }
        };

        try {
          await scanner.start(constraints);
        } catch (err) {
          console.log('High-resolution constraints failed, falling back to HD');
          await scanner.start({
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, min: 24 }
          });
        }

        setIsScanning(true);

        const tryOptimizeCamera = async () => {
          if (!videoRef.current || cancelled) return;
          const track = videoRef.current.srcObject?.getVideoTracks?.()[0];
          if (!track) return;

          setEnhancingCamera(true);

          try {
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
              const enhancementConstraints = { advanced: [] };
              let focusApplied = false;

            focusApplied = appendTrackFocusConstraints(capabilities, enhancementConstraints.advanced);

            if (capabilities.exposureMode?.includes('continuous')) {
              enhancementConstraints.advanced.push({ exposureMode: 'continuous' });
            }

            if (capabilities.exposureCompensation) {
              const { min = 0, max = 0, step = 0 } = capabilities.exposureCompensation;
              const compensation = Math.min(max, Math.max(min, step || 0));
              enhancementConstraints.advanced.push({ exposureCompensation: compensation });
            }

            if (capabilities.whiteBalanceMode?.includes('continuous')) {
              enhancementConstraints.advanced.push({ whiteBalanceMode: 'continuous' });
            }

            if (enhancementConstraints.advanced.length > 0) {
              try {
                await track.applyConstraints(enhancementConstraints);
              } catch (constraintErr) {
                console.log('Advanced constraint application failed:', constraintErr);
              }
            }

            if ('ImageCapture' in window) {
              try {
                const imageCapture = new window.ImageCapture(track);
                imageCaptureRef.current = imageCapture;
                const photoCaps = await imageCapture.getPhotoCapabilities();
                photoCapabilitiesRef.current = photoCaps;

                const photoFocusApplied = await applyPhotoFocusOptions(imageCapture, photoCaps);
                if (photoFocusApplied) {
                  focusApplied = true;
                }

                const torchAvailable = (photoCaps.fillLightMode || []).includes('torch') || photoCaps.torch;
                if (torchAvailable) {
                  setTorchSupported(true);
                }
              } catch (imageCaptureErr) {
                console.log('ImageCapture adjustments not available:', imageCaptureErr);
              }
            }

            if (focusApplied) {
              setFocusSupported(true);
            }
          } finally {
            setEnhancingCamera(false);
          }
        };

        // Wait for video metadata to ensure track exists
        if (!cancelled) {
          if (videoRef.current.readyState >= 1) {
            await tryOptimizeCamera();
          } else {
            const handleLoaded = async () => {
              videoRef.current?.removeEventListener('loadeddata', handleLoaded);
              if (!cancelled) {
                await tryOptimizeCamera();
              }
            };
            videoRef.current.addEventListener('loadeddata', handleLoaded);
          }
        }
      } catch (err) {
        let message = err?.message || '카메라를 시작할 수 없습니다.';
        if (err?.name === 'NotAllowedError' || message.includes('Permission')) {
          message = '카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라 권한을 허용해주세요.';
        } else if (message.includes('NotFoundError') || message.includes('Camera')) {
          message = '사용 가능한 카메라를 찾을 수 없습니다.';
        }
        setErrorMessage(message);
        if (typeof onError === 'function') onError(err);
      }
    }

    startScanner();

    return () => {
      if (scanner) {
        scanner.stop();
        scanner.destroy();
      }
      scannerRef.current = null;
      imageCaptureRef.current = null;
      photoCapabilitiesRef.current = null;
      cancelled = true;
    };
  }, [onScan, onError]);

  const toggleTorch = async () => {
    if (!torchSupported || !imageCaptureRef.current) return;
    try {
      const next = !torchEnabled;
      await imageCaptureRef.current.setOptions({ torch: next });
      setTorchEnabled(next);
    } catch (err) {
      console.log('Torch toggle failed:', err);
    }
  };

  const refocusCamera = useCallback(async () => {
    if (!focusSupported) return;

    const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
    try {
      if (track?.getCapabilities) {
        const { focusMode = [], focusDistance } = track.getCapabilities();
        const constraints = { advanced: [] };
        appendTrackFocusConstraints(
          { focusMode, focusDistance },
          constraints.advanced
        );

        if (constraints.advanced.length > 0) {
          await track.applyConstraints(constraints);
        }
      }

      if (imageCaptureRef.current && photoCapabilitiesRef.current) {
        await applyPhotoFocusOptions(imageCaptureRef.current, photoCapabilitiesRef.current);
      }
    } catch (err) {
      console.log('Refocus failed:', err);
    }
  }, [focusSupported]);

  useEffect(() => {
    if (!focusSupported) return;
    const interval = setInterval(() => {
      refocusCamera();
    }, 4000);
    return () => clearInterval(interval);
  }, [focusSupported, refocusCamera]);

  return (
    <div className={`qr-scanner ${className}`.trim()}>
      {errorMessage ? (
        <div className="qr-scanner__error">
          {errorMessage}
          <span className="qr-scanner__fallback">QR 코드 내용을 직접 입력하거나 붙여넣어 주세요.</span>
        </div>
      ) : (
        <div className="qr-scanner__viewport">
          <video ref={videoRef} className="qr-scanner__video" />
          <div className="qr-scanner__overlay">
            <div className="qr-scanner__corner qr-scanner__corner--tl" />
            <div className="qr-scanner__corner qr-scanner__corner--tr" />
            <div className="qr-scanner__corner qr-scanner__corner--bl" />
            <div className="qr-scanner__corner qr-scanner__corner--br" />
            {torchSupported && (
              <div className="qr-scanner__controls">
                <button type="button" className="qr-scanner__control-btn" onClick={toggleTorch}>
                  {torchEnabled ? t('wallet.torchOff') : t('wallet.torchOn')}
                </button>
              </div>
            )}
            {enhancingCamera && (
              <div className="qr-scanner__hint">{t('wallet.optimizingCamera')}</div>
            )}
          </div>
          {!isScanning && (
            <div className="qr-scanner__hint">{t('wallet.startingCamera')}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default QrScanner;
