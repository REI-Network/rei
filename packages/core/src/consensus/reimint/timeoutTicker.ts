import { BN } from 'ethereumjs-util';
import { TimeoutInfo } from './state';

export class TimeoutTicker {
  private maxHeight?: BN;
  private maxRound?: number;
  private maxStep?: number;
  private timeout?: NodeJS.Timeout;
  private onTimeout: (ti: TimeoutInfo) => void;

  constructor(onTimeout: (ti: TimeoutInfo) => void) {
    this.onTimeout = onTimeout;
  }

  schedule(ti: TimeoutInfo) {
    if (this.maxHeight === undefined || this.maxHeight.lt(ti.height)) {
      this.maxHeight = ti.height.clone();
      this.maxRound = ti.round;
      this.maxStep = ti.step;
    } else if (this.maxRound === undefined || this.maxRound < ti.round) {
      this.maxRound = ti.round;
      this.maxStep = ti.step;
    } else if (this.maxStep === undefined || this.maxStep < ti.step) {
      this.maxStep = ti.step;
    } else {
      return;
    }

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    this.timeout = setTimeout(() => {
      this.timeout = undefined;
      this.onTimeout(ti);
    }, ti.duration);
  }
}
