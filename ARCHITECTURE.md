# EXTRACT.IO – Architektur

> 100 Players. 10 Minutes. Loot. Kill. Extract. Whatever you escape with is yours.

Dieses Dokument beschreibt die technischen Entscheidungen des MVP und warum sie so getroffen wurden.

## Überblick

```
┌──────────────┐  HTTPS/JSON   ┌──────────────┐      Prisma      ┌────────────┐
│  apps/web    │ ─────────────▶│  apps/api    │ ───────────────▶ │ PostgreSQL │
│ React + Vite │               │  Fastify     │                  │            │
│  Phaser 3    │  WebSocket    ├──────────────┤      Prisma      │            │
│              │ ─────────────▶│apps/game-    │ ───────────────▶ │            │
└──────────────┘  (msgpack)    │ server (ws)  │  (Ergebnis-Port) └────────────┘
                               └──────────────┘
```

| Paket | Zweck | Läuft in |
|---|---|---|
| `packages/game-types` | Alle geteilten Typen (PlayerState, ItemDefinition, NetworkMessages, DTOs) | Browser + Node |
| `packages/game-config` | **Alle** Gameplay-Werte (Waffen, Loot, Rarities, Economy, Match, Netzwerk, Map, Bots, Season) | Browser + Node |
| `packages/shared` | Deterministische Simulation (Kollision, Movement), Map-Generator, Spatial Hash, RNG, Protokoll-Codec + Validierung, Economy-Formeln | Browser + Node |
| `packages/server-core` | Logging (pino), Analytics-Event-Bus, JWT, Env-Loading | Node |
| `packages/database` | Prisma-Schema, Migrationen, Seed, Match-Ergebnis-Repository | Node |
| `packages/blockchain` | `BlockchainProvider`-Interface, `MockBlockchainProvider`, `SolanaBlockchainProvider` (Future-Stub) | Node |
| `packages/ui` | Design-Tokens + React-Basiskomponenten | Browser |
| `apps/game-server` | Autoritativer Echtzeit-Server | Node |
| `apps/api` | REST: Auth, Inventar, Marketplace, Leaderboard, Profil, Season, Wallet | Node |
| `apps/web` | Browser-Client | Browser |

Interne Pakete werden als TypeScript-Quellcode konsumiert („just-in-time packages“): Vite und `tsx` transpilieren sie direkt, `tsup` bündelt sie für Production in die App-Bundles. Kein Build-Schritt pro Paket, keine duplizierten Typen.

## Entscheidung: eigener WebSocket-Server statt Colyseus

Colyseus wäre möglich gewesen, aber die Anforderungen (Client-Prediction mit Input-Sequenzen, eigenes Interest-Management, Delta-Replikation pro Client, Anti-Speedhack-Budget) hätten ohnehin an Colyseus' State-Sync vorbei implementiert werden müssen. Ein schlanker `ws`-Server gibt volle Kontrolle bei weniger Abstraktion:

- **Transport:** `ws`, binäre Frames, **MessagePack** (`@msgpack/msgpack`, Floats als float32).
- **Protokoll:** `packages/game-types/src/network.ts` (typisiert), Validierung jeder Client-Nachricht in `packages/shared/src/protocol/validate.ts` (strikt, unbekanntes wird verworfen).
- **Rooms** sind voneinander unabhängig (`MatchRoom`), damit sie später auf mehrere Prozesse verteilt werden können.

## Game Server

### Tick-System
- Globaler Fixed-Rate-Loop in `MatchManager` (30 Ticks/s, drift-kompensiert, max. 4 Catch-up-Ticks).
- Jede `MatchRoom.tick()`: Lobby → State-Machine → Simulation → alle 2 Ticks Snapshot (15 Hz).
- Ein Fehler in einem Room crasht nie den Prozess; nach 5 Fehlern wird nur dieser Room beendet.

### State Machines
- **Match:** `WAITING → STARTING → LOOT_PHASE → COMBAT_PHASE → EXTRACTION_PHASE → FINISHED` in `MatchStateMachine` – einzige Stelle, die Phasen wechselt. Übersprungene Zeit (Dev-Tool) feuert trotzdem jeden Zwischen-Hook in Reihenfolge.
- **Player:** `ALIVE | EXTRACTING | DISCONNECTED | DEAD | EXTRACTED` (+ `DOWNED` im Typ reserviert). `IN_WORLD` = ALIVE/EXTRACTING/DISCONNECTED (töt- und sichtbar).

### Systeme (Game Rules getrennt von Networking)
`game/systems/*`: `CombatSystem` (Feuerrate, Magazin, Reload, Projektile, Hit-Detection, Schaden, Kill-Attribution), `LootSystem` (Kisten, Pickups, Drops, Consumables), `ExtractionSystem`, `BountySystem`, `SupplyDropSystem`. Reine Logik ohne Seiteneffekte liegt in testbaren Funktionen: `lootGenerator.ts`, `damage.ts`, `deathOutcome.ts`, `RaidInventory.ts`.

### Server-Autorität / Anti-Cheat
Der Client sendet nur **Inputs** (Bewegungsachsen −1/0/1, Zielwinkel, Buttons) und **Absichten** (reload, interact, switch, useItem, Inventar-Operationen). Alles andere entscheidet der Server:

| Cheat | Gegenmaßnahme |
|---|---|
| Speedhack / Teleport | Position entsteht nur durch `stepMovement` mit fixem dt. Pro Tick wird ein **Input-Zeitbudget** gutgeschrieben; ohne Budget keine Simulation. Kein Ansparen im Leerlauf. Queue-Limit, Duplikat-/Replay-Sequenzen werden verworfen. |
| Infinite Ammo / Rapid Fire | Magazin, Reserve, Reload-Timer und `nextFireAt` nur serverseitig. |
| Fake Damage / Kill | Schaden nur durch serverseitig simulierte Projektile (Segment-vs-Kreis, Wände blockieren). |
| Fake Pickup / Duplication | Existenz + Distanz werden bei jedem Pickup geprüft; Items existieren genau einmal in der World-Map. |
| Fake Extraction | Server prüft permanent Radius, Status, Schaden; 10 s werden serverseitig gezählt. |
| Protokoll-Spam | Token-Bucket-Rate-Limit pro Verbindung, max. Frame-Größe, Kick nach zu vielen Verstößen, `security_violation`-Log. |
| Dev-Tools | Nur wenn `DEV_TOOLS=true` **und** `NODE_ENV !== production`; sonst ignoriert und als Verstoß gezählt. |

### Networking: Prediction, Reconciliation, Interpolation
- Client simuliert Inputs mit **derselben** `stepMovement`-Funktion und derselben `CollisionWorld` (Karte wird im `welcome` übertragen).
- Jeder Snapshot enthält `ack` (letzte verarbeitete Input-Sequenz) + autoritativen Self-State (inkl. Dash-Timer). Der Client verwirft bestätigte Inputs und spielt die unbestätigten erneut ab. Kleine Abweichungen werden über einen abklingenden Render-Offset geglättet, große (Teleport) direkt übernommen. Gemessen im Browser: 0.000 Einheiten Divergenz.
- Fremde Spieler werden **110 ms in der Vergangenheit** zwischen Snapshots interpoliert (Zeitbasis = Server-Match-Zeit, geglätteter Offset).
- Projektile werden als Spawn-Events (Ursprung, Winkel, Speed, Range) übertragen und clientseitig simuliert; Treffer/Wand-Ende kommen als End-Events.

### Interest Management & Delta-Updates
- `SpatialHash` (256er Zellen) für Spieler, Bodenitems, Kisten. Jeder Client erhält nur Entities in seinem Interest-Rechteck (±1000 × ±720, leicht größer als die feste logische Sicht von 1600×1000 – die Kamera zoomt so, dass niemand durch einen größeren Monitor mehr sieht).
- `ClientView` merkt sich pro Client, was bekannt ist: Snapshots enthalten nur **enter / changed / leave**. Globaler Match-State wird versioniert und nur bei Änderung gesendet.
- Gemessen (Load-Test, 100 Clients in einem Match): Tick Ø 3,6 ms, p95 ≈ 10 ms (Budget 33 ms), ~9 KB/s pro Client.

### Reconnect
Verbindung weg während des Matches → Status `DISCONNECTED`, Charakter bleibt 20 s in der Welt (tötbar, Extraktion abgebrochen). Wiederverbindung per Account (JWT) oder `reconnectKey` → Client-View wird zurückgesetzt, voller State neu übertragen. Nach Ablauf: Run gilt als verlassen (gleiche Regeln wie Tod).

### Persistenz-Port
Der Game-Server kennt nur das Interface `GamePersistence`. `PrismaPersistence` ist der Adapter, `MemoryPersistence` dient Tests/DB-losem Betrieb. `ResilientPersistence` macht Writes fire-and-forget mit exponentiellem Backoff – eine kurz ausgefallene DB blockiert nie den Game-Loop. Doppelte Gutschriften sind ausgeschlossen, weil `MatchPlayer(matchId, userId)` UNIQUE ist und Ergebnis + Items + Stats + Leaderboards in **einer** Transaktion geschrieben werden.

## Gameplay-Regeln (konfigurierbar in `packages/game-config`)
- Phasen: 00:00–02:00 Loot, 02:00–07:00 Combat (Vault/High-Value-Zone öffnet, bessere Loot-Tables), 07:00–10:00 Extraction (3 von 7 Punkten aktiv), ab 09:00 Final-Minute-Warnung, 10:00 = nicht extrahiert → nur Secure-Slot bleibt.
- Rarities 70 / 20 / 8 / 1.9 / 0.1 %; Container- und Zonen-Multiplikatoren; limitierte Items (Genesis Crown, 1000 Stück) mit atomarer Seriennummer-Vergabe beim Speichern.
- Tod: Secure-Slot bleibt; vom Rest werden zufällige Einheiten bis max. 30 % des Werts gesichert, die unerreichbare Differenz wird als TEST-USDC-„Insurance“ ausgezahlt, ≥ 70 % droppen als Loot.
- Bounty ab 5 Kills ($5, $8, $12, $18, danach ×1,5), ungefähre Position (±260) alle 5 s, Auszahlung an den Killer erst bei dessen Extraktion.
- Supply Drops ab Minute 4, angekündigt, 10 s Fallzeit, überdurchschnittlicher Loot.

## API & Marketplace
- Fastify + Zod-Validierung, JWT (HS256, geteilt mit Game-Server), Rate-Limits (strenger für Auth/Kauf), CORS.
- **Guest-Modus:** Username → sofort spielen; Registrierung optional (scrypt-Hash), wandelt den Gast-Account inkl. Inventar um.
- **Marketplace-Integrität** (alles in einer DB-Transaktion):
  1. Listing reserviert die Inventarzeile per bedingtem Update (`status=OWNED → LISTED`, Stack-Split) → kein Doppel-Listing, keine Duplikation.
  2. Kauf „claimt“ das Listing mit `UPDATE … WHERE status='ACTIVE'` → parallele Käufer serialisieren auf dem Row-Lock, genau einer gewinnt.
  3. Käufer-Abbuchung mit `WHERE balance >= price` + CHECK-Constraint `balance >= 0` → kein Überziehen/Double-Spend.
  4. `MarketplaceTransaction.listingId` und `.idempotencyKey` sind UNIQUE → Retry liefert die Originaltransaktion.
  5. Gebühr 5 % (500 bps, abgerundet): $100 → Verkäufer $95, Plattform $5.
- Geld ist überall **Integer-Cent** (keine Float-Fehler).

## Blockchain-Abstraktion
Game-Logic importiert kein Chain-SDK. Die API nutzt `BlockchainProvider` (`connectWallet`, `getBalance`, `mintItem`, `transferItem`, `burnItem`, `getAssetOwner`) über eine Factory (`BLOCKCHAIN_PROVIDER=mock|solana`). `MockBlockchainProvider` verhält sich wie eine echte Chain (Ownership-Checks), ist aber In-Memory. `SolanaBlockchainProvider` ist ein klar markierter Future-Stub, der beim Auswählen sofort fehlschlägt statt still zu „funktionieren“. On-Chain-Felder am Item (`blockchainAssetId`, `mintAddress`, `tokenId`, `chain`, `ownerWallet`) sind nullable. Wallet ist optional.

## Logging & Analytics
- Strukturierte pino-Logs mit Event-Namen: `match_started, player_joined, player_killed, item_looted, legendary_found, extraction_started, extraction_cancelled, player_extracted, match_finished, marketplace_listing, marketplace_sale` (+ `persistence_error`, `security_violation`, …).
- `AnalyticsBus` mit Sinks (Log, Memory) und Events `GAME_STARTED, MATCH_STARTED, MATCH_ENDED, PLAYER_DIED, PLAYER_EXTRACTED, ITEM_FOUND, ITEM_SOLD, ITEM_BOUGHT`. Ein externer Anbieter ist nur ein weiterer Sink.

## Client
- React für Menüs/HUD/Overlays, **Three.js** fürs Rendering (`render3d/`, enthält keine Spielregeln). Ursprünglich Phaser 3 (2D); für den gewünschten „3D von oben“-Look ersetzt – Simulation, Netzwerk und HUD blieben unverändert, weil der Renderer nur den `GameClient` liest.
- **Kamera:** Perspektive, 15° geneigt, folgt weich mit leichtem Vorausblick zum Fadenkreuz. Sichtbare Fläche bleibt ≤ 1600×1000 Einheiten (fair, egal wie groß der Monitor ist). Zielen per Raycast auf die Waffenhöhe.
- **Welt** (`MapBuilder3D`): Bodenflächen mit prozeduralen, welt-verankerten Kacheltexturen (Gras, Waldboden, Asphalt, Beton, Planken, Fliesen, Metall), Wände/Container/Maschinen als Boxen mit echter Höhe, pro Material zu einem Mesh gemerged; Bäume/Felsen als `InstancedMesh`. Baumkronen blenden per Shader-Injection rund um den eigenen Spieler aus.
- **Licht:** Hemisphere + Sonne mit Schatten (Shadow-Kamera folgt der Sicht, auf Texel gesnappt), PBR-Umgebung (`RoomEnvironment`), ACES-Tonemapping, Bloom (nur HDR-Emissives: Visiere, Lichtsäulen, Leuchtspuren).
- **Modelle:** Charaktere mit Skins (`skins.ts`, deterministisch pro Name), Outline, Laufzyklus, Rückstoß, Mündungsblitz, Treffer-Flash; Waffen pro Typ mit Rarity-Akzent; jedes Item mit eigenem 3D-Modell, Glow und ab Epic einer Lichtsäule; Kisten mit animiertem Deckel; Supply Drops fallen am Fallschirm.
- **Effekte:** Leuchtspuren als instanziertes Mesh, gepoolte Funken-Sprites, Extraction-Zonen mit Lichtsäule und Partikeln.
- **Labels** (Namen, HP, Schadenszahlen, Zonen) sind DOM-Elemente, die jedes Frame auf Weltpositionen projiziert werden – gestochen scharf.
- **Flüssigkeit:** Der eigene Spieler wird zwischen den 30-Hz-Simulationsschritten interpoliert (bei 60/144 Hz kein Treppeneffekt); Korrekturen aus der Reconciliation verschieben das Interpolationssegment und klingen weich aus. Die Kamera ist fest am Spieler, nur der Vorausblick ist geglättet. Snapshots kommen mit 30 Hz, fremde Spieler werden 75 ms verzögert interpoliert und bei verspäteten Paketen bis 70 ms extrapoliert; der Zeit-Offset folgt den am wenigsten verzögerten Paketen (jitter-stabil).
- **Schuss-Vorhersage:** Der Client simuliert eigene Schüsse sofort (Feuerrate, Magazin, Streuung, Wand-/Spieler-Kollision nur visuell); Inputs mit Schuss werden gemerkt, bis der Server sie per `ack` bestätigt (angezeigtes Magazin = Server-Magazin − unbestätigte Schüsse). Die Server-Kopien eigener Kugeln werden unsichtbar geführt und bestätigen nur Treffer.
- **Qualitätsstufen:** Low (0,75× Auflösung, kein Postprocessing) / Medium (MSAA) / High (Bloom, 2K-Schatten) / Ultra (volle Auflösung, 4K-Schatten); „Auto“ schaltet nach 3 s anhaltend langsamer Frames herunter und bei Reserve wieder hoch, Ausreißer (Tab-Wechsel) werden ignoriert.
- **Audio:** `audio/SoundEngine.ts` synthetisiert alle Sounds mit der Web Audio API (Rauschen + Oszillatoren, Kompressor, Stereo-Panning, Entfernungsdämpfung, Voice-Limit).
- **Hauptmenü:** Der Hintergrund ist die echte Karte in 3D mit Kameraflug (lazy geladen, respektiert `prefers-reduced-motion`).
- `GameClient` = Netzwerk + Prediction + Interpolation, framework-agnostisch; React liest einen gedrosselten HUD-Snapshot (10 Hz) über `useSyncExternalStore`.
- Alle Assets sind prozedural erzeugt (keine Dateien) und über `textures.ts`, `style.ts`, `skins.ts` und die Modell-Factories austauschbar.
- Die 3D-Engine wird per Code-Splitting erst beim Spielstart geladen.

## Skalierung Richtung 100 Spieler / mehrere Server
Bereits vorhanden: Interest Management, Delta-Replikation, Spatial Hashing, Projektil-Broadphase über Grid, Nav-Grid einmal pro Map geteilt, Object-Reuse in Hot-Paths, Room-Isolation.
Nächste Schritte: Rooms auf mehrere Prozesse verteilen (Matchmaking + Reconnect-Registry nach Redis, `REDIS_URL` ist reserviert), Snapshot-Encoding pro Tick parallelisieren/cachen, Lag-Kompensation (Rewind der Hitboxen um RTT/2), Worker-Threads für Bot-Pathfinding.

## Bewusste Grenzen des MVP
- Keine Lag-Kompensation für Treffer (lokal/LAN unkritisch).
- `DOWNED` ist nur als Status reserviert.
- Mock-Chain-State lebt im API-Prozess (nach Neustart vergessen).
- Items aus dem Account-Inventar können (noch) nicht mit in einen Raid genommen werden – jeder startet mit der Basic Pistol.
