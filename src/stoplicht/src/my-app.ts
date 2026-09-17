import { I18N } from '@aurelia/i18n';
import { route } from '@aurelia/router';
import { resolve } from 'aurelia';
import { PreferencesStore } from './services/preferences-store';

@route({
  routes: [
    { path: '', component: import('./pages/menu-page'), title: 'Stoplicht' },
    { path: 'play/:levelId', component: import('./pages/play-page'), title: 'Stoplicht', transitionPlan: 'replace' },
    { path: 'editor', component: import('./pages/editor-page'), title: 'Stoplicht – editor' },
  ],
})
export class MyApp {
  private readonly prefs = resolve(PreferencesStore);
  private readonly i18n = resolve(I18N);

  async binding(): Promise<void> {
    const locale = this.prefs.get('locale');
    if (this.i18n.getLocale() !== locale) await this.i18n.setLocale(locale);
  }
}
