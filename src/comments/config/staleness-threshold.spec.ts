import {
  DEFAULT_STALENESS_THRESHOLD_MS,
  resolveStalenessThresholdMs,
} from './staleness-threshold';

describe('resolveStalenessThresholdMs', () => {
  it('defaults to 15 minutes when STALENESS_THRESHOLD_MS is unset', () => {
    expect(resolveStalenessThresholdMs(undefined)).toBe(
      DEFAULT_STALENESS_THRESHOLD_MS,
    );
    expect(DEFAULT_STALENESS_THRESHOLD_MS).toBe(15 * 60 * 1000);
  });

  it('uses the configured value when set to a valid positive number', () => {
    expect(resolveStalenessThresholdMs('60000')).toBe(60_000);
  });

  it('rejects a non-numeric value', () => {
    expect(() => resolveStalenessThresholdMs('not-a-number')).toThrow(
      /STALENESS_THRESHOLD_MS/,
    );
  });

  it('rejects a zero or negative value', () => {
    expect(() => resolveStalenessThresholdMs('0')).toThrow(
      /STALENESS_THRESHOLD_MS/,
    );
    expect(() => resolveStalenessThresholdMs('-1000')).toThrow(
      /STALENESS_THRESHOLD_MS/,
    );
  });
});
