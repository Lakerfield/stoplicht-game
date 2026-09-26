import Aurelia from 'aurelia';
import { I18nConfiguration } from '@aurelia/i18n';
import { RouterConfiguration } from '@aurelia/router';
import { MyApp } from './my-app';
import nl from './locales/nl.json';
import en from './locales/en.json';

// Unknown URLs (typos, stale links; on GitHub Pages every path serves index.html) land on the menu.
const base = new URL(document.baseURI).pathname;
const relative = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname.replace(/^\//, '');
if (!/^(|play\/[^/]+|editor)\/?$/.test(relative)) history.replaceState(null, '', base);

Aurelia
  .register(
    RouterConfiguration,
    I18nConfiguration.customize(options => {
      options.initOptions = {
        lng: 'nl',
        fallbackLng: 'en',
        resources: {
          nl: { translation: nl },
          en: { translation: en },
        },
      };
    }),
  )
  .app(MyApp)
  .start();
