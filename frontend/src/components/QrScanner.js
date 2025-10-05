import React, { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';

function QrScanner({ onScan, onError, className = '' }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    let reader = null;
    let isActive = true;

    async function startScanner() {
      try {
        reader = new BrowserQRCodeReader();
        readerRef.current = reader;

        // Get video input devices (cameras)
        const videoInputDevices = await reader.listVideoInputDevices();

        if (videoInputDevices.length === 0) {
          throw new Error('NotFoundError');
        }

        // Prefer rear camera if available
        const selectedDeviceId = videoInputDevices.find(device =>
          device.label.toLowerCase().includes('back') ||
          device.label.toLowerCase().includes('rear') ||
          device.label.toLowerCase().includes('environment')
        )?.deviceId || videoInputDevices[0].deviceId;

        // Start continuous decode from video device
        const controls = await reader.decodeFromVideoDevice(
          selectedDeviceId,
          videoRef.current,
          (result, error) => {
            if (!isActive) return;

            if (result) {
              const decodedText = result.getText();
              if (decodedText && typeof onScan === 'function') {
                onScan(decodedText.trim());
                // Stop scanner after successful scan
                if (controls) {
                  controls.stop();
                }
              }
            }
            // Ignore decode errors (they're normal when no QR code is in view)
          }
        );

        setIsScanning(true);
      } catch (err) {
        if (!isActive) return;

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
      isActive = false;
      if (reader) {
        reader.reset();
      }
      readerRef.current = null;
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
          <video
            ref={videoRef}
            style={{
              width: '100%',
              maxWidth: '500px',
              borderRadius: '8px'
            }}
          />
          {!isScanning && (
            <div className="qr-scanner__hint">카메라를 시작하는 중...</div>
          )}
        </div>
      )}
    </div>
  );
}

export default QrScanner;
