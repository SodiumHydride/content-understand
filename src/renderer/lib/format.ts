export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function formatSpeed(bps: number): string {
  if (bps <= 0) return ''
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`
  return `${(bps / 1024).toFixed(0)} KB/s`
}

export function formatEta(seconds: number): string {
  if (seconds <= 0 || !Number.isFinite(seconds)) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.ceil(seconds % 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s}s`
}
