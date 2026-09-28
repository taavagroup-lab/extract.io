import type { ItemAmount } from '@extract/game-types';
import { buildShareText, xIntentUrl, type ShareResult } from '@extract/shared';
import { Button, Modal, Spinner } from '@extract/ui';
import { useEffect, useState } from 'react';
import { currentCurrency } from '../../lib/publicConfig';
import { renderShareCard } from './shareCard';

/** Share result: generated card preview, SHARE ON X (web intent), download / copy image. */
export function ShareModal({ result, items, onClose }: { result: ShareResult; items: ItemAmount[]; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const cur = currentCurrency();
  const text = buildShareText(result, cur);

  useEffect(() => {
    let revoked: string | null = null;
    let alive = true;
    void renderShareCard(result, items, cur).then((b) => {
      if (!alive) return;
      revoked = URL.createObjectURL(b);
      setBlob(b);
      setUrl(revoked);
    });
    return () => {
      alive = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
    // The card is rendered once per opened modal.
  }, []);

  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `extract-sol-${result.playerName.toLowerCase()}.png`;
    a.click();
  };

  const copy = async () => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('Image copied. Paste it into your post.');
    } catch {
      setStatus('Copy not supported here. Use Download instead.');
    }
  };

  const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

  return (
    <Modal title="Share result" onClose={onClose} wide>
      <div className="modal-body share">
        <div className="share__preview">{url ? <img src={url} alt="Extraction result card" /> : <Spinner label="Rendering card" />}</div>
        <pre className="share__text">{text}</pre>
        {status && <p className="page-notice">{status}</p>}
        <div className="modal-actions">
          {canCopy && (
            <Button variant="ghost" disabled={!blob} onClick={() => void copy()}>
              Copy image
            </Button>
          )}
          <Button disabled={!url} onClick={download}>
            Download image
          </Button>
          <Button variant="primary" onClick={() => window.open(xIntentUrl(text), '_blank', 'noopener,noreferrer')}>
            Share on X
          </Button>
        </div>
        <p className="form-hint">X posts cannot attach images through a link: download or copy the card and add it to your post.</p>
      </div>
    </Modal>
  );
}
