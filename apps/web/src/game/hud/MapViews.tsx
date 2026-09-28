import { useEffect, useRef } from 'react';
import type { GameClient } from '../net/GameClient';
import { drawMap } from './mapDrawing';

function useMapCanvas(client: GameClient, size: number, labels: boolean, intervalMs: number) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const canvas = ref.current;
      const map = client.map;
      if (!canvas || !map) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const alive = client.predictionReady;
      drawMap(ctx, map, client.global, {
        size,
        labels,
        selfX: alive ? client.renderX : null,
        selfY: alive ? client.renderY : null,
        aim: client.aim,
        now: performance.now(),
      });
    };
    draw();
    const id = window.setInterval(draw, intervalMs);
    return () => window.clearInterval(id);
  }, [client, size, labels, intervalMs]);
  return ref;
}

export function Minimap({ client }: { client: GameClient }) {
  const size = 176;
  const ref = useMapCanvas(client, size, false, 150);
  return (
    <div className="minimap">
      <canvas ref={ref} width={size} height={size} />
      <span className="minimap__hint">M · MAP</span>
    </div>
  );
}

export function MapOverlay({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const size = Math.min(760, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.86));
  const ref = useMapCanvas(client, size, true, 120);
  return (
    <div className="overlay overlay--map" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="map-card">
        <header className="overlay__header">
          <h2>MAP · GENESIS ISLE</h2>
          <div className="map-legend">
            <span><i className="dot dot--extract" /> Extraction</span>
            <span><i className="dot dot--supply" /> Supply drop</span>
            <span><i className="dot dot--bounty" /> Bounty (approx.)</span>
            <span><i className="dot dot--kingpin" /> Kingpin (approx.)</span>
            <span><i className="dot dot--vault" /> High value zone</span>
          </div>
          <button className="overlay__close" onClick={onClose} aria-label="Close map">
            ×
          </button>
        </header>
        <canvas ref={ref} width={size} height={size} className="map-canvas" />
      </div>
    </div>
  );
}
