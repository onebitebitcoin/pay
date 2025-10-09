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
            maxScansPerSecond: 10,
            preferredCamera: 'environment'
          }
        );

        scannerRef.current = scanner;

        // Start scanning
        await scanner.start();
        setIsScanning(true);
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
          <video ref={videoRef} style={{ width: '100%', maxWidth: '100%' }} />
          {!isScanning && (
            <div className="qr-scanner__hint">카메라를 시작하는 중...</div>
          )}
        </div>
      )}
    </div>
  );
}

export default QrScanner;
