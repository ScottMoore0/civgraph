/**
 * The map app as its method modules see it: `this` in packages/map/src/app/*.js. Test2App
 * (packages/map/app/app.js) is one class written as several modules; installMethods puts each
 * module's methods on its prototype, so inside a method `this` is the app. A method module that
 * joins the type check (packages/map/tsconfig.check.json) types `this` as `MapApp & <its own
 * methods class>`, per method (`@this`), and reads the rest of the app only through this interface.
 *
 * Declarations only, nothing at run time. Each member is one a checked module uses, typed by what
 * it is in the app: a field set in Test2App's constructor, or a method of another method module.
 * tests/unit/map-app-host.test.mjs holds every member to the app: a field must be assigned in the
 * constructor, a method defined by app.js or a method module. Members join as modules do.
 */
import type { CensusLegend, LegendModel } from './legend-view.mjs';
import type { TimelineChangeView } from './timeline/timeline-view.mjs';

/** A stop on the timeline: an edition (its map) or an election (packages/map/src/app/timeline/controls.js). */
export interface TimelineItem {
  mapId?: string;
  date?: unknown;
  timestamp?: unknown;
  label?: unknown;
  displayLabel?: string;
  minor?: boolean;
  [key: string]: unknown;
}

/** One pair of the boundary-change index (data/timeline-changes/index.json `pairs`). */
export interface TimelineChangeIndexEntry {
  path?: string;
  kind?: string;
  count?: number;
  text?: string;
}

/** One change of a pair file (data/timeline-changes/<pair>.json `changes`). */
export interface TimelineChange {
  id?: string;
  type?: string;
  from?: string;
  to?: string;
  ha?: number;
  point?: unknown;
  bbox?: unknown;
  [key: string]: unknown;
}

/** A pair file of data/timeline-changes/: its changes and their GeoJSON features. */
export interface TimelineChangeFile {
  changes?: TimelineChange[];
  features?: Array<{ properties?: Record<string, unknown> | null; [key: string]: unknown }>;
}

/** The changes between the edition shown before and the one shown now (changes.js buildTimelineChangeView). */
export interface TimelineChangeState extends TimelineChangeView {
  key: string;
  kind: 'changes' | 'none' | 'redrawn' | 'unknown';
  count: number;
  parts: Array<{ label: string; kind: string; count: number; text: string }>;
  changes: Array<TimelineChange & { key: string; step: string; text: string }>;
  features: Array<{ properties?: Record<string, unknown> | null; [key: string]: unknown }>;
  fromMapId: string | null;
  toMapId: string | null;
  note: string;
  drawn: boolean;
}

/** The renderer's record of a loaded layer (packages/map/src/renderer/map-controller.js). */
export interface RendererLayerRecord {
  color?: string;
  fillColor?: string;
  config?: { sourceType?: string; approximateSegments?: { note?: string } | null } | null;
}

/** One timing the map controller keeps (getMetrics). */
export interface MapMetric {
  event?: string;
  [key: string]: unknown;
}

/** What the method modules use of the main map controller (packages/map/app/maplibre-main-adapter.js). */
export interface MapControllerView {
  map: { getContainer(): HTMLElement; getLayer(id: string): unknown } | null;
  /** main map id -> the renderer's layer id. */
  mainToTest: Map<string, string>;
  renderer: { layers: Map<string, RendererLayerRecord> } | null;
  // The performance dashboard (performance.js) also asks for these, defensively; the adapter has
  // none of them today, so the dashboard reports no metrics, no loaded layers and no runtime class.
  layers?: Map<string, unknown>;
  metrics?: MapMetric[];
  runtimeProfile?: { deviceClass?: string } | null;
  getMetrics?(): MapMetric[];
  getCensusOverlayLegend(mainId: string): CensusLegend | null;
  setTimelineChanges(geojson: { features?: unknown } | null | undefined, options?: { reversed?: boolean; points?: unknown; key?: string }): boolean;
  clearTimelineChanges(): boolean;
  fitToBounds(bounds: unknown, options?: { smooth?: boolean } | null): void;
  setEditionRole(mainId: string, role: string | null | undefined): void;
}

/** What the method modules use of the election manager (packages/map/app/election-manager.js). */
export interface ElectionsView {
  activeEntry: { key?: string } | null;
  lastSeatCircleRenderMs?: number;
  legendModel(): LegendModel | null;
  getActiveElectionBackingLayerIds(): string[];
  getActiveElectionStyleSourceMapId(): string | null;
  getSeatCircleOverlayState(): unknown;
}

export interface MapApp {
  // Fields (Test2App's constructor).
  /** Aborted by dispose(): listeners on document and window pass its signal. */
  lifecycle: AbortController;
  mapController: MapControllerView | null;
  elections: ElectionsView | null;
  /** map id -> 'older' or 'newer', for two editions of one series on the map (updateEditionRoles). */
  editionRoles: Map<string, string>;
  /** The boundary-change index's pairs, by "<from map>__<to map>" (timeline/changes.js); null until loaded. */
  timelineChangeIndex: Record<string, TimelineChangeIndexEntry> | null;
  /** Pair files fetched, by URL (timeline/changes.js). */
  timelineChangeCache: Map<string, Promise<TimelineChangeFile | null>>;
  /** The changes the timeline's button describes (timeline/changes.js). */
  timelineChangeView: TimelineChangeState | null;

  // Methods of other method modules.
  /** layers.js */
  getLoadedLayerIds(): string[];
  /** layers.js */
  isMapVisible(mapId: string): boolean;
  /** layers.js */
  isMapLoaded(mapId: string): boolean;
  /** timeline/animation.js */
  getTimelineAnimationItems(): TimelineItem[];
  /** timeline/controls.js */
  formatTimelineItemLabel(item: TimelineItem | null | undefined): string;
  /** messages.js */
  mapLabel(mapId: string): string;
  /** messages.js */
  exportMapImage(mapId: string, format?: string, options?: { trigger?: HTMLElement }): Promise<unknown>;
  /** mobile-layout.js */
  isPhoneLayout(): boolean;
  /** controls.js */
  syncBasemapToTheme(): Promise<unknown>;
}
