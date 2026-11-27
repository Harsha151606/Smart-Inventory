import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function QrVerifyView({ onOpenItem, addToast }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [scannerStatus, setScannerStatus] = useState(
    'Click Start Camera to scan signed inventory QR labels using native BarcodeDetector.'
  );
  const [payloadInput, setPayloadInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  function stopCamera() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }

  useEffect(() => {
    return () => stopCamera();
  }, []);

  async function verifyQrText(rawPayload) {
    setVerifying(true);
    try {
      const res = await api('/api/qr/verify', {
        method: 'POST',
        body: JSON.stringify({ payload: rawPayload.trim() })
      });
      if (res && res.valid) {
        setScanResult({ valid: true, item: res.item });
      } else {
        setScanResult({ valid: false });
      }
    } catch {
      setScanResult({ valid: false });
    } finally {
      setVerifying(false);
    }
  }

  async function handleToggleCamera() {
    if (streamRef.current) {
      stopCamera();
      return;
    }

    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      setScannerStatus(
        'Native BarcodeDetector camera scanning is unavailable in this browser. Paste a signed QR payload on the right to verify.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            const raw = codes[0].rawValue;
            stopCamera();
            setPayloadInput(raw);
            await verifyQrText(raw);
            return;
          }
        } catch {
          // Ignore transient decode frame error
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setScannerStatus(
        'Camera permission denied or unavailable. Use manual payload verification on the right.'
      );
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = payloadInput.trim();
    if (!trimmed) {
      addToast('Paste a QR JSON payload first', 'warn');
      return;
    }
    await verifyQrText(trimmed);
  }

  return (
    <section id="view-scan" className="view">
      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head">
            <h3>Camera QR Scanner</h3>
            <button
              id="btn-toggle-camera"
              type="button"
              className="btn btn-secondary"
              onClick={handleToggleCamera}
            >
              {cameraActive ? 'Stop Camera' : 'Start Camera'}
            </button>
          </div>
          <div className="scanner-box">
            <video
              ref={videoRef}
              id="qr-video"
              className={`qr-video ${cameraActive ? '' : 'qr-video-hidden'}`}
              playsInline
              muted
            />
            {!cameraActive && (
              <p id="scanner-status" className="muted-text">
                {scannerStatus}
              </p>
            )}
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Verify Signed QR Payload</h3>
          <p className="muted-text mb-16">
            Paste a raw JSON QR payload to validate its HMAC-SHA256 signature against the server.
          </p>
          <form id="qr-verify-form" className="form-stack" onSubmit={handleSubmit}>
            <textarea
              id="qr-payload-input"
              rows={4}
              placeholder='{"id":1,"name":"USB-C Cables","type":"inventory_item","sig":"..."}'
              value={payloadInput}
              onChange={(e) => setPayloadInput(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={verifying}>
              {verifying ? 'Verifying...' : 'Verify Signature & Open Item'}
            </button>
          </form>

          {scanResult && (
            <div id="scan-result" className="scan-result">
              {scanResult.valid ? (
                <>
                  <strong className="text-ok">HMAC-SHA256 Verified</strong>
                  <p className="muted-text mb-16 tabular-nums">
                    {`${scanResult.item.name} · Stock: ${scanResult.item.quantity} ${scanResult.item.unit}`}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onOpenItem(scanResult.item.id)}
                  >
                    Open Item Details
                  </button>
                </>
              ) : (
                <>
                  <strong className="text-danger">Signature Rejected</strong>
                  <p className="muted-text">
                    This QR payload failed HMAC-SHA256 authenticity checks.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
