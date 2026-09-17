import { valueConverter } from 'aurelia';

/** Formats seconds as m:ss.d for the HUD and result screens. */
@valueConverter('time')
export class TimeFormatValueConverter {
  toView(seconds: number | null | undefined, decimals = 1): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–';
    const sign = seconds < 0 ? '-' : '';
    const abs = Math.abs(seconds);
    const minutes = Math.floor(abs / 60);
    const rest = abs - minutes * 60;
    const secStr = rest.toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0');
    return `${sign}${minutes}:${secStr}`;
  }
}
