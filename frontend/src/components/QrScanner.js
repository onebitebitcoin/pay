import React, { useEffect, useRef, useState } from 'react';
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
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 60, // Maximum scan rate for highest performance
            preferredCamera: 'environment',
            calculateScanRegion: (video) => {
              // Use a very large scan region for maximum recognition
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
        const constraints = {
          facingMode: 'environment',
          width: { ideal: 3840, min: 1280 },  // Request 4K, minimum 720p
          height: { ideal: 2160, min: 720 },
          frameRate: { ideal: 60, min: 30 },
          aspectRatio: { ideal: 16/9 },
          advanced: [
            { focusMode: 'continuous' },
            { exposureMode: 'continuous' },
            { whiteBalanceMode: 'continuous' }
          ]
        };

        try {
          await scanner.start(constraints);
        } catch (err) {
          // Fallback to high-quality constraints if ultra-high not supported
          console.log('4K camera not supported, trying Full HD');
          try {
            await scanner.start({
              facingMode: 'environment',
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              frameRate: { ideal: 60, min: 30 },
              advanced: [
                { focusMode: 'continuous' },
                { exposureMode: 'continuous' }
              ]
            });
          } catch (err2) {
            // Final fallback to minimal constraints
            console.log('Advanced camera features not supported, using basic constraints');
            await scanner.start({
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 }
            });
          }
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

            if (capabilities.focusMode?.includes('continuous')) {
              enhancementConstraints.advanced.push({ focusMode: 'continuous' });
            }

            if (capabilities.focusMode?.includes('manual') && capabilities.focusDistance) {
              const { max = 1 } = capabilities.focusDistance;
              enhancementConstraints.advanced.push({ focusMode: 'manual' });
              enhancementConstraints.advanced.push({ focusDistance: max ?? 1 });
              setFocusSupported(true);
            } else if (capabilities.focusMode?.includes('continuous')) {
              setFocusSupported(true);
            }

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

            if (capabilities.zoom) {
              const { min = 1, max = 1 } = capabilities.zoom;
              const slightZoom = Math.min(max, Math.max(min, 1.2));
              if (slightZoom > min) {
                enhancementConstraints.advanced.push({ zoom: slightZoom });
              }
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

                const focusModes = photoCaps.focusMode || [];
                if (focusModes.includes('manual') && photoCaps.focusDistance) {
                  setFocusSupported(true);
                  await imageCapture.setOptions({
                    focusMode: 'manual',
                    focusDistance: photoCaps.focusDistance.max ?? 1
                  });
                } else if (focusModes.includes('continuous')) {
                  setFocusSupported(true);
                  await imageCapture.setOptions({ focusMode: 'continuous' });
                }

                const torchAvailable = (photoCaps.fillLightMode || []).includes('torch') || photoCaps.torch;
                if (torchAvailable) {
                  setTorchSupported(true);
                }
              } catch (imageCaptureErr) {
                console.log('ImageCapture adjustments not available:', imageCaptureErr);
              }
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

  const refocusCamera = async () => {
    if (!focusSupported) return;

    const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
    try {
      if (track?.getCapabilities) {
        const { focusMode = [], focusDistance } = track.getCapabilities();
        const manualSupported = focusMode.includes('manual') && focusDistance;
        const constraints = { advanced: [] };

        if (manualSupported) {
          constraints.advanced.push({ focusMode: 'manual' });
          constraints.advanced.push({ focusDistance: focusDistance.max ?? 1 });
        } else if (focusMode.includes('continuous')) {
          constraints.advanced.push({ focusMode: 'continuous' });
        }

        if (constraints.advanced.length > 0) {
          await track.applyConstraints(constraints);
        }
      }

      if (imageCaptureRef.current && photoCapabilitiesRef.current) {
        const caps = photoCapabilitiesRef.current;
        if ((caps.focusMode || []).includes('manual') && caps.focusDistance) {
          await imageCaptureRef.current.setOptions({
            focusMode: 'manual',
            focusDistance: caps.focusDistance.max ?? 1
          });
        } else if ((caps.focusMode || []).includes('continuous')) {
          await imageCaptureRef.current.setOptions({ focusMode: 'continuous' });
        }
      }
    } catch (err) {
      console.log('Refocus failed:', err);
    }
  };

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
            <div className="qr-scanner__instruction">
              {t('wallet.qrInstruction')}
            </div>
            <div className="qr-scanner__controls">
              {focusSupported && (
                <button type="button" className="qr-scanner__control-btn" onClick={refocusCamera}>
                  {t('wallet.refocus')}
                </button>
              )}
              {torchSupported && (
                <button type="button" className="qr-scanner__control-btn" onClick={toggleTorch}>
                  {torchEnabled ? t('wallet.torchOff') : t('wallet.torchOn')}
                </button>
              )}
            </div>
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
