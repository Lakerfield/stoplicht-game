import { INode, resolve } from 'aurelia';
import type Phaser from 'phaser';
import { createGame } from '../game/create-game';
import { GameSession } from '../services/game-session';
import { PreferencesStore } from '../services/preferences-store';

/** Hosts the Phaser canvas; created on attach, destroyed on detach. */
export class GameCanvas {
  private readonly session = resolve(GameSession);
  private readonly prefs = resolve(PreferencesStore);
  private readonly host = resolve(INode) as HTMLElement;
  private game: Phaser.Game | null = null;

  attached(): void {
    this.game = createGame(this.host, this.session, this.prefs);
    if (import.meta.env.DEV) (window as unknown as { __stoplichtGame?: Phaser.Game }).__stoplichtGame = this.game;
  }

  detaching(): void {
    this.game?.destroy(true);
    this.game = null;
  }
}
