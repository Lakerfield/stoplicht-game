import { bindable, BindingMode, INode, resolve } from 'aurelia';

const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 70;

/** Labelled range slider with −/+ step buttons (hold to repeat); the value is always a number. */
export class ParamSlider {
  private readonly host = resolve(INode) as HTMLElement;
  @bindable label = '';
  @bindable unit = 's';
  @bindable min = 0;
  @bindable max = 60;
  @bindable step = 0.1;
  @bindable disabled = false;
  @bindable({ mode: BindingMode.twoWay }) value = 0;

  private holdDelay: ReturnType<typeof setTimeout> | null = null;
  private holdTimer: ReturnType<typeof setInterval> | null = null;

  onInput(event: Event): void {
    this.value = Number((event.target as HTMLInputElement).value);
  }

  get display(): string {
    const decimals = this.step < 1 ? 1 : 0;
    const sign = this.value > 0 && this.min < 0 ? '+' : '';
    return sign + this.value.toFixed(decimals);
  }

  stepBy(direction: number): void {
    if (this.disabled) return;
    const decimals = this.step < 1 ? 1 : 0;
    const next = Math.min(this.max, Math.max(this.min, this.value + direction * this.step));
    this.value = Number(next.toFixed(decimals));
    // let the parent react the same way as to slider input
    this.host.dispatchEvent(new CustomEvent('input', { bubbles: true }));
  }

  holdStart(event: PointerEvent, direction: number): void {
    event.preventDefault();
    this.holdEnd();
    this.stepBy(direction);
    this.holdDelay = setTimeout(() => {
      this.holdTimer = setInterval(() => this.stepBy(direction), HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  }

  holdEnd(): void {
    if (this.holdDelay) clearTimeout(this.holdDelay);
    if (this.holdTimer) clearInterval(this.holdTimer);
    this.holdDelay = null;
    this.holdTimer = null;
  }

  detaching(): void {
    this.holdEnd();
  }
}
