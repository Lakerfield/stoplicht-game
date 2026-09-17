import Aurelia from 'aurelia';
import { I18nConfiguration } from '@aurelia/i18n';
import { RouterConfiguration } from '@aurelia/router';
import { MyApp } from './my-app';
import nl from './locales/nl.json';
import en from './locales/en.json';

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
