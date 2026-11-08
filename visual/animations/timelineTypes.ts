import type { Locator } from '@playwright/test';
import type { CaptureArea } from './captureTypes';
import type { NumericTextMask } from './numericMask';

export type TimelineOptions = { clip?: CaptureArea; times?: readonly number[]; requireChange?: boolean; startOffset?: number;
  mask?: Locator[]; numericMask?: NumericTextMask[]; requireMotion?: boolean;
  foregroundBelow?: { y: number; locator: Locator }; excludedBackground?: Locator[];
  waitForCardSprites?: string; observeFrames?: boolean };

/** 页面主体的只读呈现采样，在采集和比较模块之间共享，避免类型反向依赖。 */
export type TimelineElement = { x: number; y: number; width: number; height: number;
  opacity: number; transforms: string[]; images: string[] };
