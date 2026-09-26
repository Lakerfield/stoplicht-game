interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** PWA installation: Chrome/Edge/Android expose a prompt; iOS Safari needs the share-sheet instructions. */
export class InstallService {
  private deferred: BeforeInstallPromptEvent | null = null;
  /** true when the browser offered an install prompt we can trigger */
  canPrompt = false;
  /** running as an installed app (standalone) */
  readonly installed: boolean;
  /** iOS Safari: no prompt API, show instructions instead */
  readonly isIos: boolean;

  constructor() {
    const nav = navigator as Navigator & { standalone?: boolean };
    this.installed = matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
    this.isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !('MSStream' in window);
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.canPrompt = true;
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.canPrompt = false;
    });
  }

  /** show the install entry whenever we are not already running as an app */
  get available(): boolean {
    return !this.installed;
  }

  /** served over https (or localhost), a requirement for the browser's own install prompt */
  get secure(): boolean {
    return window.isSecureContext;
  }

  async prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.deferred) return 'unavailable';
    await this.deferred.prompt();
    const { outcome } = await this.deferred.userChoice;
    if (outcome === 'accepted') {
      this.deferred = null;
      this.canPrompt = false;
    }
    return outcome;
  }
}
