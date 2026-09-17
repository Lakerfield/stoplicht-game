import { bindable, BindingMode } from 'aurelia';

/** Labelled range slider bound to a numeric value (range inputs deliver strings, we convert). */
export class ParamSlider {
  @bindable label = '';
  @bindable unit = 's';
  @bindable min = 0;
  @bindable max = 60;
  @bindable step = 0.1;
  @bindable disabled = false;
  @bindable({ mode: BindingMode.twoWay }) value = 0;

  onInput(event: Event): void {
    this.value = Number((event.target as HTMLInputElement).value);
  }

  get display(): string {
    const decimals = this.step < 1 ? 1 : 0;
    return this.value.toFixed(decimals);
  }
}
