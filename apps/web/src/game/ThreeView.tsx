import { useEffect, useRef } from 'react';
import type { InputController } from './input/InputController';
import type { GameClient } from './net/GameClient';
import { GameRenderer } from './render3d/GameRenderer';

/** Mounts the Three.js renderer bound to a GameClient. */
export function ThreeView({ client, controls }: { client: GameClient; controls: InputController }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const renderer = new GameRenderer(ref.current, client, controls);
    renderer.start();
    return () => renderer.dispose();
  }, [client, controls]);
  return <div ref={ref} className="game-canvas" />;
}
