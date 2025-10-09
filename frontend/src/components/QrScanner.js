import React, { useEffect, useRef, useState } from 'react';
import QrScannerLib from 'qr-scanner';

function QrScanner({ onScan, onError, className = '' }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    let scanner = null;

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
            // High-quality scanning settings
            returnDetailedScanResult: true,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 25,
            preferredCamera: 'environment',
            calculateScanRegion: (video) => {
              // Use a larger scan region for better recognition
              const smallestDimension = Math.min(video.videoWidth, video.videoHeight);
              const scanRegionSize = Math.round(0.7 * smallestDimension);
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

        // Start scanning with advanced camera constraints
        const constraints = {
          facingMode: 'environment',
          advanced: [
            { focusMode: 'continuous' },
            { focusDistance: 0 }
          ]
        };

        try {
          await scanner.start(constraints);
        } catch (err) {
          // Fallback to basic constraints if advanced features are not supported
          console.log('Advanced camera features not supported, using basic constraints');
          await scanner.start({ facingMode: 'environment' });
        }

        setIsScanning(true);

        // Try to enable torch (flash) for better scanning in low light
        // This is optional and may not be supported on all devices
        try {
          const videoTrack = videoRef.current?.srcObject?.getVideoTracks?.()?.[0];
          if (videoTrack && videoTrack.getCapabilities) {
            const capabilities = videoTrack.getCapabilities();
            if (capabilities.torch) {
              // Torch is available but we won't turn it on by default
              // Users can add a toggle button if needed
            }

            // Apply autofocus if available
            if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
              await videoTrack.applyConstraints({
                advanced: [{ focusMode: 'continuous' }]
              });
            }
          }
        } catch (err) {
          console.log('Could not apply advanced video constraints:', err);
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
    };
  }, [onScan, onError]);

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
          {!isScanning && (
            <div className="qr-scanner__hint">카메라를 시작하는 중...</div>
          )}
        </div>
      )}
    </div>
  );
}

export default QrScanner;
