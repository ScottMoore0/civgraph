const MAX_EVENTS = 120;

export class TestTelemetry {
  constructor() {
    this.events = [];
    this.fallbackCount = 0;
    this.cdnFailures = 0;
    this.lastBeaconAt = 0;
  }

  record(event = {}) {
    const clean = sanitizeEvent(event);
    if (!clean.event) return;
    if (/fallback/i.test(clean.event)) this.fallbackCount += 1;
    if (/cdn|pmtiles|fetch|network|range/i.test(`${clean.event} ${clean.reason || ''}`) && /fail|error|fallback/i.test(`${clean.event} ${clean.reason || ''}`)) {
      this.cdnFailures += 1;
    }
    this.events.push({
      at: new Date().toISOString(),
      memory: readMemory(),
      ...clean
    });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.beacon(clean);
  }

  snapshot() {
    return {
      events: this.events.slice(-20),
      fallbackCount: this.fallbackCount,
      cdnFailures: this.cdnFailures,
      memory: readMemory(),
      resourceTimings: readPmtilesTimings()
    };
  }

  beacon(event) {
    if (!navigator.sendBeacon || Date.now() - this.lastBeaconAt < 5000) return;
    if (!/civgraph\.net$|civgraph\.pages\.dev$/i.test(location.hostname)) return;
    this.lastBeaconAt = Date.now();
    const body = JSON.stringify({
      source: 'civgraph-test',
      event,
      memory: readMemory(),
      path: location.pathname
    });
    try {
      navigator.sendBeacon('/_api/rum', new Blob([body], { type: 'application/json' }));
    } catch {
      // Telemetry must never affect map loading.
    }
  }
}

function sanitizeEvent(event) {
  const output = {};
  for (const [key, value] of Object.entries(event || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' || typeof value === 'boolean') output[key] = value;
    else output[key] = String(value).slice(0, 240);
  }
  return output;
}

function readMemory() {
  const memory = performance?.memory;
  if (!memory) return null;
  return {
    usedJSHeapSize: memory.usedJSHeapSize || null,
    totalJSHeapSize: memory.totalJSHeapSize || null,
    jsHeapSizeLimit: memory.jsHeapSizeLimit || null
  };
}

function readPmtilesTimings() {
  if (!performance?.getEntriesByType) return [];
  return performance.getEntriesByType('resource')
    .filter((entry) => /\.pmtiles/i.test(entry.name))
    .slice(-12)
    .map((entry) => ({
      name: entry.name.split('/').pop(),
      durationMs: Math.round(entry.duration),
      transferSize: entry.transferSize || null,
      encodedBodySize: entry.encodedBodySize || null
    }));
}
