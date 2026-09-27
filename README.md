# EXTRACT.IO

**100 Players. 10 Minutes. Loot. Kill. Extract. Whatever you escape with is yours.**

Browser-Multiplayer-Extraction-Shooter (Top-Down 2D): Loot sammeln, andere Spieler bekämpfen, rechtzeitig extrahieren. Extrahierter Loot landet im persistenten Account-Inventar und kann auf einem internen Marketplace (TEST USDC) gehandelt werden.

- **Client:** React + Vite + Phaser 3 (Client-Prediction, Server-Reconciliation, Interpolation)
- **Game Server:** Node.js + TypeScript + `ws`, server-autoritativ, 30 Ticks/s, Interest Management, Delta-Updates
- **API:** Fastify + Prisma + PostgreSQL (Guest-Login, Inventar, Marketplace, Leaderboards, Seasons, Wallet)
- **Monorepo:** pnpm Workspaces

Architektur & Entscheidungen: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Requirements

| Tool | Version |
|---|---|
| Node.js | ≥ 20.12 (getestet mit 24) |
| pnpm | ≥ 10 (`npm i -g pnpm` oder `corepack enable`) |
| PostgreSQL | 14+ – per **Docker Compose** *oder* ohne Docker per `pnpm db:embedded` |

## Quickstart

```bash
pnpm install
pnpm setup              # erstellt .env aus .env.example
docker compose up -d    # Postgres (ohne Docker: `pnpm db:embedded` in eigenem Terminal)
pnpm db:setup           # Migrationen anwenden + Seed (Season 1, Items, Demo-Marketplace)
pnpm dev                # Web + Game Server + API
```

Dann **http://localhost:5173** öffnen → Username eingeben → **PLAY**.

| Dienst | URL |
|---|---|
| Web Client | http://localhost:5173 |
| API | http://localhost:3001 (im Browser über `/api` proxied) |
| Game Server | ws://localhost:3002/ws (im Browser über `/ws` proxied) |
| Game-Server-Metriken | http://localhost:3002/metrics |

## Install

```bash
pnpm install
```
`postinstall` generiert den Prisma-Client automatisch.

## Environment Variables

`pnpm setup` kopiert `.env.example` nach `.env` (existierende `.env` wird nie überschrieben). Niemals echte Secrets committen.

| Variable | Default | Beschreibung |
|---|---|---|
| `NODE_ENV` | `development` | `production` deaktiviert Dev-Tools und anonymes Spielen hart |
| `LOG_LEVEL` | `info` | pino Log-Level; `LOG_FORMAT=json` für JSON-Logs in Dev |
| `DATABASE_URL` | `postgresql://extract:extract@localhost:5432/extractio?schema=public` | PostgreSQL |
| `CHECKPOINT_DISABLE` | `1` | verhindert, dass die Prisma-CLI in restriktiven Netzen hängt |
| `REDIS_URL` | *(leer)* | reserviert für Multi-Node-Matchmaking, im MVP ungenutzt |
| `JWT_SECRET` | dev-Wert | geteilt von API (signiert) und Game Server (prüft); in Prod ≥ 32 Zeichen |
| `API_PORT` / `API_URL` | `3001` | REST API |
| `CORS_ORIGIN` | `http://localhost:5173` | kommagetrennte Origins |
| `GAME_SERVER_PORT` / `GAME_SERVER_URL` | `3002` / `ws://localhost:3002/ws` | Game Server |
| `MATCH_TARGET_PLAYERS` | `20` | Spieler pro Match (Menschen + Bots), max. 100 |
| `MATCH_FILL_WITH_BOTS` | `true` | Lobby mit Bots auffüllen; `false` = Start ab 2 Menschen |
| `LOBBY_WAIT_SECONDS` | `8` | Wartezeit auf Menschen, bevor Bots auffüllen |
| `DEV_TOOLS` | `true` | Dev-Panel + `/dev/*`-Endpoints (in Production immer aus) |
| `ALLOW_ANONYMOUS_PLAY` | `true` | WebSocket-Join ohne Account (Load-Tests; in Production immer aus) |
| `BLOCKCHAIN_PROVIDER` | `mock` | `mock` \| `solana` (Future-Stub, schlägt bewusst fehl) |
| `VITE_API_URL` / `VITE_GAME_SERVER_URL` | *(optional)* | nur nötig, wenn der Client nicht über den Vite-Proxy läuft |

## Database Setup

**Mit Docker:**
```bash
docker compose up -d
```

**Ohne Docker (echte PostgreSQL-Binaries aus npm, Daten in `./.data/pg`):**
```bash
pnpm db:embedded      # läuft im Vordergrund, Ctrl+C stoppt
```

## Migration

```bash
pnpm db:deploy        # vorhandene Migrationen anwenden (CI / erste Einrichtung)
pnpm db:seed          # Season 1 "THE GENESIS", alle ItemDefinitions, Demo-Marketplace
pnpm db:setup         # beides
pnpm db:migrate       # Entwicklung: Schema geändert -> neue Migration erzeugen
pnpm db:studio        # Prisma Studio
```
Die Item-Definitionen in `packages/game-config/src/items.ts` sind die Quelle der Wahrheit; `db:seed` spiegelt sie in die DB (idempotent). `SEED_DEMO_MARKET=false` überspringt die Demo-Listings.

## Run Development

```bash
pnpm dev              # alle drei Apps parallel (Hot Reload)
```

### Start Web Client
```bash
pnpm dev:web
```
### Start Game Server
```bash
pnpm dev:game
```
### Start API
```bash
pnpm dev:api
```

## Spielen

| Taste | Aktion |
|---|---|
| **WASD** | Bewegen |
| **Maus** / **Linksklick** | Zielen / Schießen |
| **R** | Nachladen |
| **E** | Looten / Kiste öffnen |
| **Space** | Dash |
| **1 / 2 / 3** | Waffenslots |
| **Tab** | Inventar (Secure-Slot, Drop, Use) |
| **M** | Karte |
| **H / G** | Medkit / Armor Plate benutzen |
| **`** oder **F2** | Dev-Panel (nur Dev) |

Ablauf: Loot-Phase (0–2 min) → Combat-Phase (2–7 min, *The Vault* öffnet) → Extraction-Phase (7–10 min, 3 Extraction-Punkte aktiv, 10 s in der Zone bleiben). Wer bei 10:00 nicht extrahiert ist, behält nur den Secure-Slot.

### Zwei Spieler lokal testen (Browser 1 + Browser 2)

Zwei Tabs im **selben** Browser teilen sich sonst die Session. Deshalb gibt es Session-Slots:

- Tab 1: http://localhost:5173/?slot=1
- Tab 2: http://localhost:5173/?slot=2

(Alternativ zweiter Browser / privates Fenster.) Beide innerhalb der Lobby-Zeit auf PLAY → gleiches Match. Ohne Bots testen: `MATCH_FILL_WITH_BOTS=false` in `.env` – das Match startet dann, sobald 2 Menschen in der Lobby sind. Spieler, die innerhalb der ersten 90 s eines laufenden Matches suchen, joinen ebenfalls dort.

Um nicht 7 Minuten auf die Extraction-Phase zu warten: Dev-Panel (`` ` ``) → **→ 06:57** oder **Activate extraction**, dann **→ Rooftop Heli** o. ä.

## Spawn Bots

```bash
pnpm bots             # 20 Bots ins laufende Match (bzw. Lobby)
pnpm bots 50
```
Oder im Spiel über das Dev-Panel. Bots laufen, looten, reagieren auf Gegner, schießen, heilen sich und laufen zur Extraction – über exakt dieselben Input-Pfade wie Menschen.

## Dev Tools (nur Development)

Dev-Panel im Spiel: Spawn Item, Spawn Bots, Damage (self / nächster Spieler), Teleport (inkl. zu aktiven Zonen), Activate Extraction, Set Match Time, Give Legendary, Heal, End Match.
HTTP: `POST /dev/spawn-bots?count=N`, `GET /dev/rooms`. Alles serverseitig nur aktiv, wenn `DEV_TOOLS=true` **und** `NODE_ENV!=production`.

## Reset Database

```bash
pnpm db:reset         # droppt alles, wendet Migrationen neu an, seedet
```
Danach sind vorhandene Browser-Sessions ungültig (einfach neuen Namen eingeben).

## Test

```bash
pnpm test             # alle Pakete
pnpm typecheck        # strict TypeScript über alle Pakete
```

Abgedeckt u. a.: Loot-Generierung (Verteilung, Limited Supply), Schadensberechnung + Rüstung, Player Death (70/30-Split, Secure Slot, Item-Erhaltung), Inventar, Extraction (Abbruch bei Schaden/Verlassen/Disconnect), Reconnect, Anti-Cheat (Speedhack, Replay, Feuerrate/Munition, Pickup-Distanz, Dev-Tools in Prod), Bounty, Persistenz-Retries, ein komplettes 2-Spieler-Szenario (Waffe → Kill → Loot → Extraction → Persistenz), Bot-Match mit 20 Spielern, Marketplace (Kauf, 5 %-Gebühr, Idempotenz, parallele Doppelkäufe, Balance-Rollback, Ownership, Doppel-Listing, Cancel), Wallet/Mint, Auth.

Die API-Integrationstests laufen gegen PostgreSQL in einem **eigenen Schema** (`extract_test`, wird automatisch migriert/geseedet) und berühren deine Dev-Daten nicht. Ohne erreichbare DB werden sie übersprungen.

## Load Test

```bash
pnpm loadtest                         # 20 Clients, 60 s
pnpm loadtest --clients 50
pnpm loadtest --clients 100 --duration 120
```
Simulierte WebSocket-Clients joinen, bewegen sich, zielen, schießen und looten; das Skript fragt `/metrics` ab und gibt Tick-Dauer (Ø/p95/max), Tickrate, verbundene Clients, Nachrichten/s, Bandbreite und Speicher aus. Für 100 Clients in **einem** Match den Game Server mit `MATCH_TARGET_PLAYERS=100` starten.

Referenz (Windows-Laptop, 100 Clients, ein Match): Tickrate 30/s stabil, Tick Ø 3,6 ms, p95 10,4 ms (Budget 33 ms), ~9 KB/s pro Client, ~120 MB RSS.

## Production Build

```bash
pnpm build            # tsup (game-server, api) + vite build (web)
NODE_ENV=production pnpm start   # startet API + Game Server aus dist/
```
`apps/web/dist` ist statisch und kann von jedem CDN/Webserver ausgeliefert werden. Ohne Vite-Proxy `VITE_API_URL` und `VITE_GAME_SERVER_URL` beim Build setzen (bzw. `/api` und `/ws` per Reverse-Proxy auf die Dienste routen). In Production: eigenes `JWT_SECRET`, `pnpm db:deploy` vor dem Start.

## Projektstruktur

```
apps/
  web/            React + Phaser Client (Menü, HUD, Inventar, Marketplace, Leaderboard, Profil)
  game-server/    Autoritativer Match-Server (Rooms, Systeme, Bots, Netzwerk, Persistenz-Port)
  api/            REST API (Auth, Inventar, Marketplace, Leaderboard, Season, Wallet)
packages/
  game-types/     geteilte Typen
  game-config/    alle Gameplay-Werte (match, weapons, loot, player, extraction, economy, network, map, bots, season)
  shared/         deterministische Simulation, Map-Generator, Protokoll, Economy-Formeln
  server-core/    Logging, Analytics, JWT, Env
  database/       Prisma-Schema, Migrationen, Seed, Repositories
  blockchain/     BlockchainProvider + Mock (+ Solana-Stub)
  ui/             Design-Tokens + React-Komponenten
scripts/          setup + embedded Postgres
```

## Troubleshooting

- **`EPERM … query_engine-windows.dll.node` bei `pnpm install`** (Windows): laufende Server halten die Prisma-Engine gesperrt. Server stoppen, `pnpm db:generate` erneut ausführen.
- **Prisma-CLI hängt nach „Datasource …“:** `CHECKPOINT_DISABLE=1` in `.env` (ist im Template gesetzt).
- **„API unreachable“ im Browser:** läuft `pnpm dev`? Ist Postgres erreichbar (`pnpm db:setup` ausgeführt)?
- **Zwei Tabs, ein Charakter:** `?slot=1` / `?slot=2` verwenden (siehe oben).
- **Keine Genesis Crown mehr:** das Supply von 1000 ist erschöpft – der Server rollt dann ein Tier tiefer.
