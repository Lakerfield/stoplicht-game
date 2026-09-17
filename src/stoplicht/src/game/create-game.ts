import Phaser from 'phaser';
import type { GameSession } from '../services/game-session';
import { GameScene } from './game-scene';
import { THEME } from './theme';

export function createGame(parent: HTMLElement, session: GameSession): Phaser.Game {
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
    input: { activePointers: 3 },
    scene: [new GameScene(session)],
  });
}
