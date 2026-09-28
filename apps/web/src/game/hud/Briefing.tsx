import { ECONOMY_CONFIG, EXTRACTION_CONFIG } from '@extract/game-config';
import { Button } from '@extract/ui';

const KEY = 'extract.briefing.v1';

export function hasSeenBriefing(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // storage blocked: never nag
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // ignore
  }
}

const STEPS = [
  { title: 'Loot.', text: 'Open crates and grab valuables. Your BAG VALUE shows what you carry.' },
  { title: 'Kill.', text: 'Other raiders want your bag. Whatever they carried drops when they go down.' },
  { title: 'Extract.', text: `Reach an open extraction zone and hold it for ${EXTRACTION_CONFIG.durationMs / 1000} seconds.` },
];

/** One-time, 10-second explanation shown before the first raid. */
export function Briefing({ onEnter }: { onEnter: () => void }) {
  const lost = Math.round(ECONOMY_CONFIG.death.dropRatio * 100);
  return (
    <div className="briefing">
      <div className="briefing__card">
        <p className="x-kicker">First raid</p>
        <h1 className="briefing__title">
          {STEPS.map((s) => (
            <span key={s.title}>{s.title.toUpperCase()}</span>
          ))}
        </h1>
        <ol className="briefing__steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="briefing__idx">0{i + 1}</span>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <ul className="briefing__rules">
          <li className="is-good">Anything you extract is added to your inventory.</li>
          <li className="is-bad">Die before extraction and most carried loot is lost ({lost}% drops where you fall).</li>
          <li className="is-secure">Secure Slot items are protected.</li>
        </ul>
        <Button
          variant="primary"
          size="lg"
          autoFocus
          onClick={() => {
            markSeen();
            onEnter();
          }}
        >
          Enter match
        </Button>
      </div>
    </div>
  );
}
