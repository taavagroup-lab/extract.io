import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import type { InputController } from './input/InputController';
import type { GameClient } from './net/GameClient';
import { GameScene } from './render/GameScene';

/** Mounts one Phaser game bound to a GameClient. */
export function PhaserGame({ client, controls }: { client: GameClient; controls: InputController }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: ref.current,
      backgroundColor: '#07090d',
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      scene: [new GameScene(client, controls)],
      banner: false,
      disableContextMenu: true,
      render: { antialias: true, powerPreference: 'high-performance' },
      fps: { target: 60 },
    });
    return () => game.destroy(true);
  }, [client, controls]);
  return <div ref={ref} className="game-canvas" />;
}
