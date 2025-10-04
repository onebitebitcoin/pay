import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

function QrScanner({ onScan, onError, className = '' }) {
  const scannerRef = useRef(null);
  const elementIdRef = useRef(`qr-scanner-${Math.random().toString(36).substring(7)}`);
  const [errorMessage, setErrorMessage] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    let scanner = null;
    const elementId = elementIdRef.current;

    async function startScanner() {
      try {
        scanner = new Html5Qrcode(elementId);
        scannerRef.current = scanner;

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        };

        await scanner.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            // Success callback
            if (decodedText && typeof onScan === 'function') {
              onScan(decodedText.trim());
              // Stop scanner after successful scan
              if (scanner && scanner.isScanning) {
                scanner.stop().catch(err => console.error('Failed to stop scanner:', err));
              }
            }
          },
          (errorMessage) => {
            // Error callback - we can ignore these as they're mostly "no QR code found" messages
          }
        );

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
      if (scanner && scanner.isScanning) {
        scanner.stop()
          .then(() => {
            scanner.clear();
          })
          .catch(err => {
            console.error('Failed to stop scanner:', err);
          });
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
          <div id={elementIdRef.current} style={{ width: '100%' }} />
          {!isScanning && (
            <div className="qr-scanner__hint">카메라를 시작하는 중...</div>
          )}
        </div>
      )}
    </div>
  );
}

export default QrScanner;
