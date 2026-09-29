# EXTRACT.SOL – Architektur

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
`game/systems/*`: `CombatSystem` (Munition, Reload inkl. Shell-by-Shell, Projektile, Pierce, Hit-Detection, Schaden mit Rüstungs-Multiplikator, Kill-Attribution – *wann* geschossen wird, entscheidet der geteilte Waffen-Controller, siehe „Waffensystem 2.0“), `LootSystem` (Kisten, Pickups, Drops, Consumables), `ExtractionSystem`, `BountySystem`, `SupplyDropSystem`. Reine Logik ohne Seiteneffekte liegt in testbaren Funktionen: `lootGenerator.ts`, `damage.ts`, `deathOutcome.ts`, `RaidInventory.ts`.

### Server-Autorität / Anti-Cheat
Der Client sendet nur **Inputs** (Bewegungsachsen −1/0/1, Zielwinkel, Buttons) und **Absichten** (reload, interact, switch, useItem, Inventar-Operationen). Alles andere entscheidet der Server:

| Cheat | Gegenmaßnahme |
|---|---|
| Speedhack / Teleport | Position entsteht nur durch `stepMovement` mit fixem dt. Pro Tick wird ein **Input-Zeitbudget** gutgeschrieben; ohne Budget keine Simulation. Kein Ansparen im Leerlauf. Queue-Limit, Duplikat-/Replay-Sequenzen werden verworfen. |
| Infinite Ammo / Rapid Fire | Magazin, Reserve und Reload-Timer nur serverseitig. Die Feuer-Kadenz läuft im Waffen-Controller in **Input-Zeit** – Inputs sind durch das Zeitbudget begrenzt, also kann kein Client schneller schießen als die Waffe erlaubt. |
| No-Spread | Die Größe des Streukegels ist deterministisch (Client zeigt ihn exakt an), der **Zufallswinkel darin** wird nur auf dem Server gewürfelt – ein clientbekannter Seed würde „No-Spread“-Kompensation erlauben. |
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
- **Threat-Tiers** (`threat.ts`): NORMAL / HIGH VALUE ($10) / WANTED ($25) / KINGPIN ($50) auf Basis des serverseitigen Bag Value. `KingpinSystem` prüft alle 500 ms (nicht jeden Tick), setzt das Player-Flag `KINGPIN` (Nameplate + goldener Ring für Spieler in der Nähe), sendet einmalig `kingpin`-Events (mit Cooldown gegen Flackern) und veröffentlicht alle 15 s eine unscharfe Position (±320) im globalen Match-State. `kingpinReveal.enabled=false` macht KINGPIN rein kosmetisch.
- **Season-XP** (`progression.ts`, `shared/progression.ts`): Überleben (1/s, max. 600), Kills (50), Bounty-Kills (100), Extraktion (+250, +10 pro 1 USDC, max. 3000). Nur der Game-Server berechnet XP und persistiert sie mit dem Match-Ergebnis (idempotent).

## Waffensystem 2.0

**Daten** (`game-types/weapons.ts`, `game-config/weapons.ts`): Jede Waffe ist eine vollständige `WeaponDefinition` – Schaden, Rüstungs-Multiplikator, Feuermodus (`SEMI`/`AUTO`/`BURST` + Pellets für Schrotflinten), Feuerrate (RPM), Burst-Anzahl/-Abstand, Magazin, Munitionstyp, Reload-Stil (`MAGAZINE` mit Tactical-Reload / `SHELL` Schale für Schale), Raise-Zeit, Projektilgeschwindigkeit + Reichweite (= Lebensdauer), Falloff, Pierce, Streuung stehend/bewegt, Bloom pro Schuss/Max/Erholung, Bewegungstempo, Rückstoß, Audio-Keys und `visual` (Mündungsabstand, Flash-/Tracer-/Impact-/Hülsen-Typ, Tracer jede N-te Kugel, Kick, Kamera-Impuls, Shake, LMG-Vibration). Attachment-Slots und `applyWeaponModifiers` (Handling-Varianten statt „Legendary = 3× Schaden“) sind als Datenstruktur vorbereitet. Waffen-Items (Name, Rarity, Beschreibung) werden aus den Definitionen erzeugt.

| Waffe | Rolle | Modus | Treffer bis Kill* | TTK* |
|---|---|---|---|---|
| Scout-9 (Pistol, Start) | Backup | SEMI | 8 | 1,27 s |
| Hammer .50 (Heavy Pistol) | Präzise Handkanone | SEMI | 3 | 1,04 s |
| Viper-9 (SMG) | Nahkampf-Tracking | AUTO 900 | 8 | 0,47 s |
| Wisp SD (Suppressed SMG) | leise, präziser | AUTO 800 | 10 | 0,69 s |
| Havoc AR (Assault Rifle) | Allrounder | AUTO 600 | 6 | 0,50 s |
| Raven MK2 (Burst, Bullpup) | Skill-Waffe | BURST ×3 | 5 | 0,60 s |
| Warden BR (Battle Rifle) | Präzisionsschaden, AP | SEMI | 3 | 0,60 s |
| Breaker-12 (Shotgun) | Extremer Nahkampf | Pump, 8 Pellets | 1 (alle Pellets, ≤110) | – |
| Hailstorm (Auto Shotgun) | Nahkampf-Dauerfeuer | AUTO, 6 Pellets | 3 | 0,55 s |
| Longshot (Sniper) | Fernkampf, AP | SEMI (Bolt) | 2 | 1,25 s |
| Atlas LMG | Suppression, blüht auf | AUTO 720, 80er Gurt | 8 | 0,58 s |
| Void Rifle (Legendary) | Handling-Upgrade, durchschlägt 1 Ziel | AUTO 600 | 6 | 0,50 s |

\* ohne Rüstung, alle Treffer im vollen Schadensbereich. Tests (`shared/test/weapons.test.ts`) erzwingen: nichts außer der Pump-Shotgun one-shottet, TTK 0,4–1,4 s, AR 5–7 Treffer, Shotgun auf Distanz < 25 Schaden. Neue Munitionsart `heavy` (Heavy Pistol, Battle Rifle, Sniper).

**Waffen-Controller** (`shared/weapons.ts`): läuft auf dem Server **und** in der Client-Prediction mit denselben Inputs – Feuerkadenz (exakt, ohne „Ansparen“ im Leerlauf), Semi-Trigger mit 140-ms-Puffer, Bursts, Bloom, Bewegungs-/Dash-Streuung, Raise-Zeit nach Waffenwechsel, Dry-Fire. Zustände werden abgeleitet statt als Booleans gespeichert: `READY → FIRING → COOLDOWN`, dazu `RELOADING`, `EMPTY`, `SWITCHING`, `DEAD` (`weaponPhase`).

**Projektil statt Hitscan:** Server-simulierte schnelle Projektile bleiben (1 500–4 400 u/s): Distanz wird spürbar, Tracer sind echt, Segment-Tests pro Tick sind billig. Sniper/Void sind nahezu Hitscan. Der Server startet Kugeln in der Spielermitte (Wände zwischen Körper und Mündung blockieren korrekt); der Client zeichnet Tracer ab der Mündung (`visual.muzzleDistance`, mit den Modellen abgeglichen).

**Netzwerk:** Lokal sofort: Mündungsfeuer, Kick, Kamera-Impuls, Sound, Hülse, Tracer, Magazinzähler, Waffenwechsel-Anzeige, Reload-Start. Serverseitig: Schuss, Treffer, Schaden, Kill, Munition. Treffer-Blut/-Funken erscheinen erst mit der Server-Bestätigung (Geister-Kopie der eigenen Kugel bzw. `dmg`-Event); ein Abzug mit Munition bricht einen Reload ab (Client ignoriert den Server-Reload bis zum `ack` dieses Inputs). Durchschläge (Pierce) kommen als `BulletEnd` mit `hit = 2`.

**Bots** wählen die Waffe mit der kürzesten erwarteten Time-to-Kill für die aktuelle Distanz (Falloff, Pellets, Streuung vs. Hitbox), pulsen den Abzug bei SEMI/BURST, bleiben mit dem Sniper stehen und laden in ruhigen Momenten taktisch nach.

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
- **Market-Referenzpreise:** Floor (niedrigster aktiver Preis pro Einheit) und Last Sale (pro Einheit) werden pro Seite mit zwei gruppierten SQL-Queries für die sichtbaren Item-IDs geladen – keine N+1-Abfragen.
- **Leaderboards:** paginiert (`page`, `pageSize` ≤ 50), stabile Ränge (`value DESC, updatedAt ASC`); der eigene Rang kommt aus einer einzigen indizierten Count-Query. Neue Kategorien `SEASON_XP` und `KINGPIN_EXTRACTIONS`.
- **Öffentliche Config / Status:** `GET /config` liefert nur nicht-geheime Werte (Token-Identität, Währungsmodus). `GET /status` liest `/status` des Game-Servers (verbundene Menschen, laufende Raids; Bots zählen nicht), 5 s gecacht; ist der Game-Server nicht erreichbar, meldet die API „unbekannt“ – das Menü blendet die Zahlen dann aus statt zu raten.

## Branding & Währung
- Marke `EXTRACT.SOL`, Community `$EXTRACT`, Domain `extract.io`: Copy zentral in `game-config/src/brand.ts`, Komponenten `Wordmark`, `SeasonBadge`, `TokenBadge`, `Usdc` im Web. Interne Namespaces (`@extract/*`, Tabellen, Protokoll) bleiben unverändert.
- `formatMoney` (shared) formatiert jeden Betrag nach `CURRENCY_MODE`: `TEST` → „84.72 TEST USDC“, `LIVE` → „$84.72“. Die API erzwingt `TEST`, solange der Mock-Provider aktiv ist. Share-Karte und X-Text nutzen dieselbe Funktion.
- `$EXTRACT` ist ausschließlich eine Identitäts-/Community-Anzeige (`COMING_SOON`/`COMMUNITY`); es gibt bewusst keinen Preis, Market Cap, Holder-Count oder Handel.

## Blockchain-Abstraktion
Game-Logic importiert kein Chain-SDK. Die API nutzt `BlockchainProvider` (`connectWallet`, `getBalance`, `mintItem`, `transferItem`, `burnItem`, `getAssetOwner`) über eine Factory (`BLOCKCHAIN_PROVIDER=mock|solana`). `MockBlockchainProvider` verhält sich wie eine echte Chain (Ownership-Checks), ist aber In-Memory. `SolanaBlockchainProvider` ist ein klar markierter Future-Stub, der beim Auswählen sofort fehlschlägt statt still zu „funktionieren“. On-Chain-Felder am Item (`blockchainAssetId`, `mintAddress`, `tokenId`, `chain`, `ownerWallet`) sind nullable. Wallet ist optional.

## Logging & Analytics
- Strukturierte pino-Logs mit Event-Namen: `match_started, player_joined, player_killed, item_looted, legendary_found, extraction_started, extraction_cancelled, player_extracted, match_finished, marketplace_listing, marketplace_sale` (+ `persistence_error`, `security_violation`, …).
- `AnalyticsBus` mit Sinks (Log, Memory) und Events `GAME_STARTED, MATCH_STARTED, MATCH_ENDED, PLAYER_DIED, PLAYER_EXTRACTED, ITEM_FOUND, ITEM_SOLD, ITEM_BOUGHT`. Ein externer Anbieter ist nur ein weiterer Sink.

## Client
- React für Menüs/HUD/Overlays, **Three.js** fürs Rendering (`render3d/`, enthält keine Spielregeln). Ursprünglich Phaser 3 (2D); für den gewünschten „3D von oben“-Look ersetzt – Simulation, Netzwerk und HUD blieben unverändert, weil der Renderer nur den `GameClient` liest.
- **Kamera:** Perspektive, 19° geneigt, folgt weich mit leichtem Vorausblick zum Fadenkreuz. Rückstoß ist eine kritisch gedämpfte Feder gegen die Schussrichtung (verschiebt nur die Sicht, nie den Zielpunkt) plus dezenter Trauma-Shake. Sichtbare Fläche bleibt ≤ 1600×1000 Einheiten (fair, egal wie groß der Monitor ist). Zielen per Raycast auf die Waffenhöhe.
- **Welt** (`MapBuilder3D`): Bodenflächen mit prozeduralen, welt-verankerten Kacheltexturen (Gras, Waldboden, Asphalt, Beton, Planken, Fliesen, Metall), Wände/Container/Maschinen als Boxen mit echter Höhe, pro Material zu einem Mesh gemerged; Bäume/Felsen als `InstancedMesh`. Baumkronen blenden per Shader-Injection rund um den eigenen Spieler aus.
- **Licht:** Hemisphere + Sonne mit Schatten (Shadow-Kamera folgt der Sicht, auf Texel gesnappt), PBR-Umgebung (`RoomEnvironment`), ACES-Tonemapping, Bloom (nur HDR-Emissives: Visiere, Lichtsäulen, Leuchtspuren).
- **Color-Grade-Pass** (`GradePass.ts`, ab MEDIUM, eine Fullscreen-Pass im linearen HDR vor dem Tonemapping): Vibrance (nur entsättigte Farben), Log-Kontrast, Split-Toning (kühle Schatten / warme Lichter nur für Neutraltöne), Vignette; Gameplay-Tints: niedrige HP entsättigen den Rand, Extraktion hebt die Ränder ins Grüne. Inspiriert vom Post-Stack von INKWAVE.
- **Modelle:** Charaktere mit Skins (`skins.ts`, deterministisch pro Name), Outline, Laufzyklus, Rückstoß, Mündungsblitz, Treffer-Flash; Waffen pro Typ mit Rarity-Akzent; jedes Item mit eigenem 3D-Modell, Glow und ab Epic einer Lichtsäule; Kisten mit animiertem Deckel; Supply Drops fallen am Fallschirm.
- **Effekte:** Leuchtspuren als instanziertes Mesh pro Tracer-Familie (nur jede N-te Kugel hell, Sniper mit Dampfspur, Void mit Nachleuchten), GPU-Partikel für Mündungsrauch/Funken/Impacts (Beton, Metall, Holz, Sand, Laub × leicht/normal/Pellet/schwer/Void), gepoolte 3D-Hülsen mit Bounce (ein Draw Call), Near-Miss-Whiz, Extraction-Zonen mit Lichtsäule und Partikeln.
- **Waffen-Rig** (`models/CharacterModel.ts`, `models/weapons.ts`, `models/MuzzleFlash.ts`): 12 prozedurale Modelle mit Mündungs-, Auswurf-, Magazin- und Pump/Bolt-Ankern; Haltung pro Typ (Pistole beidhändig gestreckt, Langwaffen geschultert), Arme greifen die Griffe, Sway, Aim-Lag, Kick mit Feder-Rückkehr, Wechsel-Animation (senken → tauschen → heben), Reload-Animation (Magazin raus/rein, Durchladen, Schale für Schale), Pump/Bolt-Zyklus nach dem Schuss, Todes-Animation mit Leiche. Statische Teile werden pro Material gemerged (Waffen, Operator pro Skin, Kisten pro Typ).
- **Labels** (Namen, HP, Schadenszahlen, Zonen) sind DOM-Elemente, die jedes Frame auf Weltpositionen projiziert werden – gestochen scharf.
- **Flüssigkeit:** Der eigene Spieler wird zwischen den 30-Hz-Simulationsschritten interpoliert (bei 60/144 Hz kein Treppeneffekt); Korrekturen aus der Reconciliation verschieben das Interpolationssegment und klingen weich aus. Die Kamera ist fest am Spieler, nur der Vorausblick ist geglättet. Snapshots kommen mit 30 Hz, fremde Spieler werden 75 ms verzögert interpoliert und bei verspäteten Paketen bis 70 ms extrapoliert; der Zeit-Offset folgt den am wenigsten verzögerten Paketen (jitter-stabil).
- **Schuss-Vorhersage:** Der Client führt denselben Waffen-Controller wie der Server aus und simuliert eigene Schüsse sofort (Kadenz, Bursts, Magazin, Streukegel, Wand-/Spieler-Kollision nur visuell); Inputs mit Schuss werden gemerkt, bis der Server sie per `ack` bestätigt (angezeigtes Magazin = Server-Magazin − unbestätigte Schüsse). Die Server-Kopien eigener Kugeln werden unsichtbar geführt und bestätigen nur Treffer.
- **Qualitätsstufen:** Low (0,75× Auflösung, kein Postprocessing) / Medium (MSAA) / High (Bloom, 2K-Schatten) / Ultra (volle Auflösung, 4K-Schatten); „Auto“ schaltet nach 3 s anhaltend langsamer Frames herunter und bei Reserve wieder hoch, Ausreißer (Tab-Wechsel) werden ignoriert.
- **Audio:** `audio/SoundEngine.ts` synthetisiert alle Sounds mit der Web Audio API (Rauschen + Oszillatoren, Kompressor, Stereo-Panning, Voice-Limit). Waffen: geschichteter Schuss pro Waffe (Crack, Body, Thump, Tail, Mechanik/Pump/Bolt, Energie-Zap), Reload-Phasen je Familie (Pistole, Gewehr, Gurt, Schale, Energie) – vom Reload-Fortschritt getrieben, damit abgebrochene Reloads still bleiben –, Equip, Empty-Click, Pickup, Impacts nach Oberfläche, Near-Miss-Whiz. Entfernung dämpft Lautstärke und Höhen (Luftabsorption).
- **Fadenkreuz:** zeigt den echten Streukegel auf Cursor-Distanz (öffnet sofort, schließt weich), Kreis bei Schrotflinten, Hit-/Rüstungs-/Kill-Marker, Reload-Ring, Low-Ammo-Tönung und „RELOAD / NO AMMO“.
- **Dev-Waffenmenü** (Dev-Panel): jede Waffe direkt ausrüsten, Infinite Ammo, Hitboxen, Projektilpfade, Streukegel mit Falloff-Grenzen, Mündungspunkt vs. Konfiguration, Live-Waffenstatistik (`render3d/WeaponDebug.ts`, `lib/devFlags.ts`).
- **Hauptmenü:** Der Hintergrund ist die echte Karte in 3D mit Kameraflug (lazy geladen, respektiert `prefers-reduced-motion`).
- `GameClient` = Netzwerk + Prediction + Interpolation, framework-agnostisch; React liest einen gedrosselten HUD-Snapshot (10 Hz) über `useSyncExternalStore`. Das HUD hat keinen eigenen Frame-Ticker mehr (nur der Timer tickt mit 4 Hz); zeitlich begrenzte Effekte (Treffer-Vignette, Kill-Confirm, Toasts, KINGPIN-Banner, Extraction-Abbruch) sind CSS-Animationen, die per Event-ID neu starten.
- **HUD** (`game/hud/`): `BagValue` (Wert + Threat-Tier + Fortschritt zur nächsten Stufe), `ExtractionHud` (Countdown-Ring, Abbruch-Feedback, Richtungs-Beacon zur nächsten offenen Zone), `Alerts` (KINGPIN, Bounty, Loot-Toasts „LEGENDARY ACQUIRED … + X TEST USDC BAG VALUE“).
- **Post-Match:** `ResultScreens` + `share/shareCard.ts` (Canvas 1200×675, Fonts vorgeladen) + `ShareModal` (Download, Clipboard, X-Web-Intent ohne API).
- **Menüs:** `Atmosphere` (Grid-Parallax, Glow folgt dem Zeiger per CSS-Variablen in einem rAF, Grain, Scanlines; aus bei `prefers-reduced-motion`), delegierte Hover-/Klick-Sounds (`uiSounds.ts`), einmaliges Briefing vor dem ersten Raid (`localStorage`).
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
