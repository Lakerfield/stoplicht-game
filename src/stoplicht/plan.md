Stoplicht — Eisenlijst
16 Sept 2026 · @Michael Lakerveld
1. Concept en doel
Een deterministische verkeerspuzzel: de speler stemt verkeerslichten af zodat alle auto's zo snel mogelijk de map verlaten. Auto's verschijnen op vaste tijdstippen aan de randen van een stadskaart (bovenaanzicht), rijden hun route en verlaten de map. De klok stopt zodra de laatste auto weg is; doel is de target-tijd van het level te halen.
• Platform: web (desktop en mobiel), touch- en muisbediening
• Techniek: Aurelia 2 (UI) + Phaser 3 (rendering), TypeScript
• Definitieve naam: Stoplicht — domein: stoplicht.com
2. Simulatiekern
De simulatie is volledig deterministisch: dezelfde level + dezelfde lichtinstellingen geeft altijd exact dezelfde eindtijd, op elk apparaat.
• Fixed timestep (bijv. 60 ticks/seconde), losgekoppeld van de render-framerate; rendering interpoleert tussen ticks
• Geen randomness in de simulatie; alle spawns, snelheden en beslissingen zijn afgeleid van leveldata + lichtinstellingen
• Alle simulatielogica in vaste, platformonafhankelijke rekenkunde (let op floating-point consistentie of gebruik integers/fixed-point voor posities)
• Auto's rijden vloeiend: optrekken met vaste acceleratie, afremmen met vaste deceleratie tot maximumsnelheid van hun type
• Volggedrag: een auto remt af en stopt met vaste minimale volgafstand achter een stilstaande/langzamere voorganger
• Auto's stoppen voor de stopstreep bij rood; bij groen trekken ze op zodra er ruimte is
• Een auto die de stopstreep al gepasseerd is bij het omslaan van het licht rijdt door
• De leveltijd loopt vanaf start en stopt op de tick waarin de laatste auto de map verlaat
• Eenheden: de simulatie rekent in meters en seconden; 1 tile = 8 m (rendering schaalt daaroverheen)
• Remgedrag: een auto begint te remmen op remafstand v²/(2·deceleratie) vóór het stoppunt (stopstreep of voorganger), zodat hij daar exact tot stilstand komt
• Optrek-reactietijd: 0,3 s vertraging voordat een auto reageert op groen of op het wegrijden van zijn voorganger — deterministisch, geeft het realistische harmonica-effect in files (default, per level aanpasbaar)
3. Verkeerslichten
Elk kruispunt heeft in v1 twee gekoppelde fasen: noord-zuid groen óf oost-west groen, nooit tegelijk.
• Instelbaar per kruispunt door de speler: groenduur fase A, groenduur fase B, offset (startverschuiving van de cyclus t.o.v. t=0)
• Vaste ontruimingstijd tussen de fasen (alles-rood of geel), als levelconstante (default 2 s) — niet instelbaar door de speler
• Instelbereik en stapgrootte per parameter zijn levelconstantes (bijv. 1–60 s in stappen van 0.1 s)
• Datamodel voorbereid op uitbreiding: een kruispunt heeft een lijst van lichtgroepen; v1 vult die altijd met de twee standaardparen, later kunnen lichten individueel worden
• Wegen zonder kruispunt hebben geen lichten; een kruispunt zonder lichten (voorrangskruising) is een mogelijke latere uitbreiding
4. Wegen en map
De map is een tile-/grid-gebaseerde stadskaart in bovenaanzicht met wegen, kruispunten en randen waar auto's op- en afrijden.
• Per level een mix van tweerichtingswegen (één rijstrook per richting) en éénrichtingswegen
• Auto's rijden in v1 alleen rechtdoor; elke auto heeft een route-veld in de data zodat afslaan later toegevoegd kan worden zonder herontwerp
• Inhalen bestaat niet; per rijstrook geldt strikte volgorde
• De map kan groter zijn dan het scherm: verslepen/pannen met muis (drag) en touch (swipe); zoom is een latere uitbreiding
• Randen van de map bevatten spawn-punten (invoer) en exit-punten (uitvoer); een rechtdoorgaande weg heeft aan de overzijde automatisch zijn exit
• Mapgrootte begrensd op overzichtelijkheid: richtlijn maximaal circa 10–20 verkeerslichten (kruispunten) per map; vroege levels aanzienlijk kleiner (1–3 kruispunten)
5. Voertuigen en spawns
Elke auto in een level is vooraf gedefinieerd: spawnpunt, spawntijd en voertuigtype liggen vast in de leveldata.
Default fysicawaarde (per level aanpasbaar)
Auto
Vrachtwagen
Lengte
4,5 m
10 m
Topsnelheid
14 m/s (≈ 50 km/h)
11 m/s (≈ 40 km/h)
Acceleratie
2,5 m/s²
1,2 m/s²
Deceleratie (comfortabel remmen)
4 m/s²
3 m/s²
Volgafstand bij stilstand
1,5 m
2,0 m
• Meerdere voertuigtypes per level mogelijk; types en hun waarden staan in de leveldata, niet hardcoded; bovenstaande waarden zijn de defaults en per level aanpasbaar in de editor (onder ‘Geavanceerd’)
• Spawn geblokkeerd door file: de auto wacht in een onzichtbare wachtrij buiten beeld en rijdt op zodra er ruimte is; latere spawns op hetzelfde punt schuiven mee op
• De leveltijd loopt gewoon door terwijl auto's buiten beeld wachten — dichtslibben straft zichzelf via de klok
• Het totaal aantal auto's per level is eindig en vooraf bekend; UI toont resterend aantal (op de map + in wachtrij + nog te spawnen)
• Ook de niet-voertuiggebonden fysicawaarden (optrek-reactietijd, ontruimingstijd) zijn per level instelbaar via de leveldata, met de genoemde defaults
6. Botsingen en faalcondities
Een auto rijdt bij groen het kruispunt op, ook als de uitrit erachter vol staat; wie het kruispunt blokkeert riskeert een botsing met kruisend verkeer.
• Botsingsdefinitie: kruisend verkeer krijgt groen (na de ontruimingstijd) en rijdt het kruisingsvlak op terwijl daar nog een voertuig stilstaat → botsing
• Gevolg van een botsing: game-over voor die run; speler moet resetten. Crash-animatie + visuele markering van het betrokken kruispunt
• Botsing-gedrag is een levelinstelling/moeilijkheid: strikt (botsing = game-over) of mild (vastgelopen auto blokkeert alleen, geen crash) — makkelijke levels mild, latere levels strikt
• Omdat de simulatie deterministisch is, is elke botsing exact reproduceerbaar; feedback moet de speler helpen begrijpen wáár het misging
7. Winnen, target-tijd en leaderboard
Een run is geslaagd als alle auto's de map hebben verlaten binnen de target-tijd van het level; de eindtijd is de score.
• Elk level heeft één target-tijd (gehaald/niet gehaald); geen sterren/medailles in v1
• Per level wordt de beste eindtijd van de speler lokaal bewaard, plus de bijbehorende lichtinstellingen (zodat de speler zijn beste oplossing terug kan laden)
• Leaderboard v1: lokaal op het apparaat; v2: online. Een leaderboard-entry = level-id + lichtinstellingen; de eindtijd wordt geverifieerd door de run server-side (of client-side) opnieuw te simuleren — determinisme als anti-cheat
• Na een run toont een resultaatscherm: eindtijd, target-tijd, gehaald/niet, verschil met persoonlijk record
8. Besturing van de simulatie
Lichten worden uitsluitend vóór de start ingesteld; tijdens de run zijn alle instellingen bevroren. Het spel is daarmee een pure planningspuzzel: instellen → simuleren → resultaat bekijken → bijstellen.
• Bediening: start, pauze, reset (terug naar t=0 met behoud van instellingen), versnellen (1x / 2x / 4x)
• Versnellen verandert alleen het aantal simulatieticks per seconde reële tijd; de simulatie-uitkomst blijft identiek
• Reset is altijd beschikbaar en gratis; itereren is de kern van de gameplay
9. Progressie
Levels staan in een vaste volgorde en worden ontgrendeld door de target-tijd van het vorige level te halen.
• Level 1 is altijd speelbaar; level N+1 ontgrendelt bij het halen van de target-tijd van level N
• Voortgang (ontgrendelde levels, beste tijden, beste instellingen) wordt lokaal opgeslagen (localStorage/IndexedDB); export/sync later
• De eerste levels fungeren als tutorial: één kruispunt (alleen groenduur), dan twee kruispunten (offset introduceren), dan mix van wegtypes, dan strikte botsingsmodus
10. Level-editor en levelformaat
Een level is één JSON-document. De in-game editor is in v1 een verborgen dev-tool waarmee de standaardlevels worden gemaakt; normale spelers zien hem niet.
• Editor verborgen achter een geheime ontgrendeling: 7× shift-klikken (desktop) of 7× tikken (touch) op het versienummer in het hoofdmenu; ontgrendeling wordt per apparaat onthouden (vlag in localStorage), met een optie om hem weer te verbergen
• Levelformaat bevat: gridafmetingen, wegen (positie, richting(en)), kruispunten (met lichtgroepen en levelconstantes zoals ontruimingstijd), spawn-definities (punt, tijd, voertuigtype), voertuigtype-definities, target-tijd, botsingsmodus, standaard-lichtinstellingen
• Editorfuncties v1: wegen tekenen/wissen, richting instellen, kruispunten plaatsen, spawns definiëren op een tijdlijn, target-tijd zetten, level testen
• Export vanuit de editor: download van het level als JSON-bestand (bijv. level1.json) om handmatig op de server te plaatsen als standaardlevel
• Import in de editor: bestaand level-JSON inladen om bij te werken
• Standaardlevels worden door de game geladen als statische JSON-bestanden vanaf de server (bijv. /levels/level1.json plus een manifest/index met volgorde en metadata)
• Openbare editor voor spelers, met publicatie-eis dat de maker zijn eigen target-tijd eerst haalt (à la Mario Maker), verschuift naar later — samen met online delen en het online leaderboard
• Versienummer in het levelformaat vanaf dag één, zodat oude levels bruikbaar blijven bij formaatwijzigingen
11. UI/UX
Alle interactie werkt gelijkwaardig met touch en muis; tap-doelen minimaal 44×44 px.
• Tap/klik op een kruispunt opent een instellingenpaneel met sliders (groenduur A, groenduur B, offset) en de actuele fase-indicator
• De lichtcyclus van een kruispunt is visueel afleesbaar op de map (lichtkleuren per richting), ook uitgezoomd
• HUD toont: lopende tijd, target-tijd, aantal auto's nog onderweg/in wachtrij/te spawnen, snelheidsknoppen, start/pauze/reset
• Pannen van de map mag niet conflicteren met tikken op kruispunten (drag-drempel instellen)
• Bij een botsing: crash-animatie, camera-hint of markering naar het kruispunt, duidelijke game-over-melding met resetknop
• Kleurgebruik van lichten ook onderscheidbaar voor kleurenblinden (positie/vorm naast kleur)
• Taal: Nederlands standaard, Engels als keuze in v1; alle UI-teksten via een i18n-laag (bijv. Aurelia i18n), extra talen in v2 of later
• Geluid: on-the-fly gesynthetiseerd met de Web Audio API (geen audiobestanden): duidelijke effecten voor crash en finish; motor-, acceleratie- en remgeluiden zacht op de achtergrond; mute-knop in de UI
12. Technische architectuur
Drie duidelijk gescheiden lagen: simulatiecore, Phaser-rendering, Aurelia-UI.
• Simulatiecore: pure TypeScript-module zonder Phaser/DOM-afhankelijkheden. Input: leveldata + lichtinstellingen; output: state per tick + eindresultaat. Hierdoor unit-testbaar en herbruikbaar voor server-side verificatie van leaderboard-runs
• Phaser 3: rendert de map, auto's en lichten op basis van de simulatiestate; interpoleert posities tussen ticks; handelt pan/camera en tap-detectie op kruispunten af
• Aurelia 2: alle HTML-UI — menu's, levelkeuze, HUD, kruispuntpaneel, resultaatscherm, editor-panelen — als overlay op het Phaser-canvas; communicatie via een event-/state-brug (bijv. Aurelia's DI met een gedeelde GameState-service)
• Phaser-canvas in één Aurelia-component met correcte lifecycle (attach/detach, resize)
• Leveldata, savegames en instellingen als JSON; opslag via localStorage/IndexedDB achter een storage-interface (zodat online sync later inplugbaar is)
• Assets: sprites voor wegen/auto's/lichten, sprite-atlas; werkt op mobiel Safari/Chrome en desktop
13. Open punten en latere uitbreidingen
Besloten uitbreidingen (na v1): afslaan via routes, individueel instelbare lichten per kruispunt, T-splitsingen (kruispunten met drie wegen), zoom, online leaderboard met run-verificatie, online level delen, extra talen naast Nederlands en Engels.
Alle open punten zijn besloten; de naam is definitief Stoplicht (stoplicht.com).

