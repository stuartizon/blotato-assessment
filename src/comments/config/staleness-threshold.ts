// Not specified in docs/api-endpoints.md beyond "the configured staleness
// threshold" — 15 minutes, via STALENESS_THRESHOLD_MS, was agreed as a
// deliberate default. See docs/ASSUMPTIONS.md.
export const DEFAULT_STALENESS_THRESHOLD_MS = 15 * 60 * 1000;

export function resolveStalenessThresholdMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_STALENESS_THRESHOLD_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid STALENESS_THRESHOLD_MS: ${raw} (must be a positive number of milliseconds)`,
    );
  }

  return parsed;
}
