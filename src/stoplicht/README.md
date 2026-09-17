# Stoplicht

Deterministische verkeerspuzzel: stem verkeerslichten af zodat alle auto's zo snel mogelijk de map verlaten.
Zie `plan.md` voor de volledige eisenlijst.

## Stack

- **Simulatiekern** `src/sim/` – pure TypeScript, geen DOM/Phaser. Fixed timestep (60 ticks/s), doubles met
  alleen `+ - * /` en `Math.sqrt` (bit-exact op elk platform). Unit-tests in `test/sim/`.
- **Rendering** `src/game/` – Phaser 3 scene die de simulatiestate tekent (interpolatie tussen ticks),
  pan/zoom/pinch en tik-op-kruispunt afhandelt.
- **UI** `src/pages/`, `src/components/` – Aurelia 2 overlay op het canvas (HUD, kruispuntpaneel,
  resultaat/botsing). Teksten via `@aurelia/i18n` (`src/locales/nl.json`, `en.json`).
- **Services** `src/services/` – `GameSession` (brug UI ⇄ Phaser ⇄ simulatie), `LevelLoader`,
  `ProgressStore` (localStorage achter een storage-interface).
- **Levels** `public/levels/*.json` + `index.json` manifest. Formaat in `src/sim/level-schema.ts`
  (`formatVersion` vanaf dag één).

## Schermen

- **Hoofdmenu** (`/`): levellijst met ontgrendeling (doel van level N halen ontgrendelt N+1), taal NL/EN, geluid.
  Editor ontgrendelen: 7× shift-klik (desktop) of 7× tik (touch) op het versienummer; "editor verbergen" zet hem weer uit.
- **Spelen** (`/play/:levelId`): HUD, kruispuntpaneel, resultaat/botsing, geluid via Web Audio (gesynthetiseerd).
- **Editor** (`/editor`): wegen tekenen/wissen, richting cyclen, kruispunten en spawnpunten worden afgeleid.
  Klik op een spawnpunt (kaart, tijdlijnlabel of zijbalk) voor een popup met reeks-generator en de lijst van dat punt.
  Tijdlijn: klik op een lege plek voegt een auto toe (shift = vrachtwagen), stippen zijn versleepbaar, klik op een
  stip opent bewerken/verwijderen. Verder geavanceerde fysica, level testen, JSON import/export, autosave in localStorage.
  Met de editor ontgrendeld (dev-modus) zijn alle levels direct speelbaar.

Botsingen (strikte modus) worden geometrisch bepaald: twee voertuigen uit verschillende lichtgroepen botsen als hun
carrosserieën elkaar binnen het kruispuntvak daadwerkelijk overlappen.

## Levels genereren en afstemmen

De twintig standaardlevels komen uit één generator (layout, spawnreeksen, voertuigmix per level):

    python3 scripts/generate-levels.py          # schrijft public/levels/level*.json + index.json (behoudt doeltijden)
    npx vite-node -c scripts/vite-node.config.ts scripts/tune-level.ts public/levels/level2.json 600 --apply

De tuner zoekt goede lichtinstellingen (hill climbing met random restarts) en zet met `--apply` de doeltijd op
≈ beste gevonden tijd + 8%, altijd duidelijk onder wat de default-instellingen halen. Draai daarna de generator
nog eens om `index.json` bij te werken.

Voertuigtypes (defaults in `src/sim/defaults.ts`): auto, vrachtwagen, motor, bus, bestelbus, tractor. Het veld `kind`
bepaalt alleen de tekenstijl; het gedrag volgt uit lengte, topsnelheid, acceleratie, remvermogen en volgafstand.

## Deploy naar GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` (handmatig starten via *Actions → Deploy to GitHub Pages → Run workflow*).
Zet in de repo-instellingen *Pages → Source* op **GitHub Actions**. De build krijgt `BASE_PATH=/<repo>/` zodat de app onder
`https://<user>.github.io/<repo>/` werkt; `dist/404.html` vangt directe links zoals `/play/level3` op. Bij een eigen domein
(stoplicht.com) `BASE_PATH` op `/` zetten.

## Commando's

    npm install
    npm start          # dev server op http://localhost:9000
    npm test           # lint + vitest
    npm run build

## Levelformaat in het kort

- `roads`: axis-aligned segmenten `{ from, to, oneWay? }`; kruispunten worden afgeleid waar segmenten
  elkaar raken (≥ 3 buren). Bochten (2 buren, niet collineair) zijn gewoon wegen.
- `spawnPoints`: op de maprand aan een wegeinde; `route` (waypoints) optioneel, standaard rechtdoor.
- `spawns`: `{ time, spawnPoint, vehicleType }`, `vehicleTypes` met lengte/topsnelheid/(de)celeratie/volgafstand.
- `constants`: ontruimingstijd, reactietijd, slider-bereiken, `lockedParams` voor tutorial-levels.
- `defaultLightSettings`: per kruispunt `{ green: { A, B }, offset }`.
