import Phaser from 'phaser';
import type { GameSession } from '../services/game-session';
import type { PreferencesStore } from '../services/preferences-store';
import { GameScene } from './game-scene';
import { THEME } from './theme';

export function createGame(parent: HTMLElement, session: GameSession, prefs?: PreferencesStore): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: THEME.ground,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    render: { antialias: true, roundPixels: false },
    // limit mode must be on from the start so the scene can change the cap at runtime (idle throttling)
    fps: { limit: 60 },
    input: { activePointers: 3 },
    scene: [new GameScene(session, prefs)],
  });
}
