import { INode, resolve } from 'aurelia';
import type Phaser from 'phaser';
import { createGame } from '../game/create-game';
import { GameSession } from '../services/game-session';

/** Hosts the Phaser canvas; created on attach, destroyed on detach. */
export class GameCanvas {
  private readonly session = resolve(GameSession);
  private readonly host = resolve(INode) as HTMLElement;
  private game: Phaser.Game | null = null;

  attached(): void {
    this.game = createGame(this.host, this.session);
  }

  detaching(): void {
    this.game?.destroy(true);
    this.game = null;
  }
}
