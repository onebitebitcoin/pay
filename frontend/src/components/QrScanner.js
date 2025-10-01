import React, { useEffect, useRef, useState } from 'react';

const CAN_USE_MEDIA =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === 'function';

function stopStream(stream, videoEl) {
  if (stream) {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (err) {
        // ignore track stop errors
      }
    });
  }
  if (videoEl) {
    try {
      videoEl.pause();
    } catch (err) {
      // ignore pause errors
    }
    videoEl.srcObject = null;
  }
}

function QrScanner({ onScan, onError, className = '' }) {
  const videoRef = useRef(null);
  const animationRef = useRef(null);
  const scannedRef = useRef(false);
  const streamRef = useRef(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const videoElement = videoRef.current;

    async function setupScanner() {
      if (!CAN_USE_MEDIA) {
        const err = new Error('이 브라우저에서는 카메라 접근을 지원하지 않습니다.');
        setErrorMessage(err.message);
        if (typeof onError === 'function') onError(err);
        return;
      }

      try {
        const constraints = { video: { facingMode: { ideal: 'environment' } } };
        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stopStream(mediaStream, videoElement);
          return;
        }

        streamRef.current = mediaStream;
        const videoEl = videoElement;
        if (!videoEl) {
          stopStream(mediaStream);
          streamRef.current = null;
          return;
        }

        videoEl.srcObject = mediaStream;
        try {
          await videoEl.play();
        } catch (err) {
          const playError = new Error('카메라 스트림을 재생할 수 없습니다. 권한을 확인해 주세요.');
          setErrorMessage(playError.message);
          stopStream(mediaStream, videoEl);
          streamRef.current = null;
          if (typeof onError === 'function') onError(playError);
          return;
        }

        if (typeof window.BarcodeDetector !== 'function') {
          const detectorError = new Error('QR 스캔을 지원하는 BarcodeDetector API가 없습니다.');
          setErrorMessage(detectorError.message);
          stopStream(mediaStream, videoEl);
          streamRef.current = null;
          if (typeof onError === 'function') onError(detectorError);
          return;
        }

        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

        const detect = async () => {
          if (cancelled || scannedRef.current) {
            return;
          }

          try {
            if (videoEl.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
              const barcodes = await detector.detect(videoEl);
              if (barcodes && barcodes.length > 0) {
                const value = barcodes[0].rawValue || '';
                if (value) {
                  scannedRef.current = true;
                  stopStream(streamRef.current, videoEl);
                  streamRef.current = null;
                  if (typeof onScan === 'function') onScan(value.trim());
                  return;
                }
              }
            }
          } catch (err) {
            if (!cancelled) {
              setErrorMessage('QR 코드를 스캔하는 중 오류가 발생했습니다.');
              stopStream(streamRef.current, videoEl);
              streamRef.current = null;
              if (typeof onError === 'function') onError(err);
            }
            return;
          }

          animationRef.current = requestAnimationFrame(detect);
        };

        detect();
      } catch (err) {
        const message = err && err.message ? err.message : '카메라를 시작할 수 없습니다.';
        setErrorMessage(message);
        if (typeof onError === 'function') onError(err);
      }
    }

    setupScanner();

    return () => {
      cancelled = true;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      scannedRef.current = false;
      stopStream(streamRef.current, videoElement);
      streamRef.current = null;
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
          <video ref={videoRef} muted playsInline className="qr-scanner__video" />
          <div className="qr-scanner__overlay">
            <div className="qr-scanner__corner qr-scanner__corner--tl" />
            <div className="qr-scanner__corner qr-scanner__corner--tr" />
            <div className="qr-scanner__corner qr-scanner__corner--bl" />
            <div className="qr-scanner__corner qr-scanner__corner--br" />
          </div>
          <div className="qr-scanner__hint">QR 코드를 중앙에 맞춰 주세요</div>
        </div>
      )}
    </div>
  );
}

export default QrScanner;
