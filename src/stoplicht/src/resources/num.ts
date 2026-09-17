import { valueConverter } from 'aurelia';

/** Two-way number binding for <input type="number">: the DOM delivers strings, the model wants numbers. */
@valueConverter('num')
export class NumValueConverter {
  toView(value: number | null | undefined): string {
    return value === null || value === undefined || Number.isNaN(value) ? '' : String(value);
  }

  fromView(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
}
