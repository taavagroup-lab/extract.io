import { useEffect, useRef } from 'react';

/**
 * Menu background layers: parallax grid, a soft accent glow that trails the
 * pointer, film grain and faint scanlines. Pointer tracking writes CSS
 * variables in one rAF per frame; React never re-renders for it.
 */
export function Atmosphere() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let tx = 0.5;
    let ty = 0.4;
    let x = tx;
    let y = ty;
    let raf = 0;
    const loop = () => {
      x += (tx - x) * 0.06;
      y += (ty - y) * 0.06;
      el.style.setProperty('--mx', x.toFixed(4));
      el.style.setProperty('--my', y.toFixed(4));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.0005 ? requestAnimationFrame(loop) : 0;
    };
    const onMove = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth;
      ty = e.clientY / window.innerHeight;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="atmo" aria-hidden="true">
      <div className="atmo__grid" />
      <div className="atmo__glow" />
      <div className="atmo__vignette" />
      <div className="atmo__scan" />
      <div className="atmo__grain" />
    </div>
  );
}
