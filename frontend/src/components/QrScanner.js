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

        // Start scanning with advanced camera constraints for maximum performance
        const constraints = {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60 },
          advanced: [
            { focusMode: 'continuous' }
            // Note: focusDistance removed to allow camera to auto-focus on close objects
            // focusDistance: 0 means infinity, which causes blur at close range
          ]
        };

        try {
          await scanner.start(constraints);
        } catch (err) {
          // Fallback to basic constraints if advanced features are not supported
          console.log('Advanced camera features not supported, using basic constraints');
          try {
            await scanner.start({
              facingMode: 'environment',
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            });
          } catch (err2) {
            // Final fallback to minimal constraints
            await scanner.start({ facingMode: 'environment' });
          }
        }

        setIsScanning(true);

        // Try to optimize camera settings for QR scanning
        // This is optional and may not be supported on all devices
        try {
          const videoTrack = videoRef.current?.srcObject?.getVideoTracks?.()?.[0];
          if (videoTrack && videoTrack.getCapabilities) {
            const capabilities = videoTrack.getCapabilities();
            const constraintsToApply = { advanced: [] };

            // Apply continuous autofocus for close-range scanning
            if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
              constraintsToApply.advanced.push({ focusMode: 'continuous' });
            }

            // Set focus distance for close-range QR codes if supported
            // focusDistance: 0 = infinity, 1 = closest
            // Using 0.5-0.8 range for optimal QR code scanning at typical distances
            if (capabilities.focusDistance) {
              const { min, max } = capabilities.focusDistance;
              // Try to set focus to mid-close range (good for QR codes at 10-30cm)
              const optimalDistance = Math.min(max, Math.max(min, 0.7));
              try {
                constraintsToApply.advanced.push({ focusDistance: optimalDistance });
              } catch (e) {
                // Focus distance might not work, continue without it
              }
            }

            // Apply the constraints if we have any
            if (constraintsToApply.advanced.length > 0) {
              await videoTrack.applyConstraints(constraintsToApply);
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
