import maplibregl from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';
import {
  CLICK_TOLERANCE_PX,
  DEFAULT_TEXT_SCALE,
  HOVER_THROTTLE_MS,
  IRELAND_BOUNDS
} from './config.js';
import {
  buildLabelColorExpression,
  buildLabelFilter,
  buildLabelFontStack,
  buildLabelSortExpression,
  buildLabelTextExpression,
  buildLabelTextSizeExpression,
  getFeatureLabel,
  getLabelMaxZoom,
  getLabelMinZoom,
  getLabelStyle
} from './labels.js';
import { repairFeatureProperties } from './feature-property-repairs.js';
import { absoluteTileTemplate, boundsToFlatBbox, boundsToImageCoordinates, boundsToMapLibre, clamp } from './utils.js';

const INTERACTION_FILL_COLOR = '#FDBA74';
const INTERACTION_STROKE_COLOR = '#FF7A1A';
const DEFAULT_VECTOR_FILL_OPACITY = 0;
const MOBILE_GESTURE_CHROME_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '.maplibregl-ctrl',
  '.test2-main-zoom-control',
  '.active-layers-toggle',
  '.map-controls',
  '.map-control-panel',
  '.active-layers',
  '.feature-info',
  '.test2-source-panel',
  '.test2-election-pane-resizer',
  '#timelineSlider'
].join(',');
const EMPTY_FEATURE_COLLECTION = Object.freeze({
  type: 'FeatureCollection',
  features: []
});

function isMobileGestureChromeTarget(target) {
  return Boolean(target?.closest?.(MOBILE_GESTURE_CHROME_SELECTOR));
}

function firstTwoTouchPoints(event) {
  if (!event?.touches || event.touches.length < 2) return null;
  const first = event.touches[0];
  const second = event.touches[1];
  if (!first || !second) return null;
  return [
    { x: first.clientX, y: first.clientY },
    { x: second.clientX, y: second.clientY }
  ];
}

function midpoint(points) {
  return {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2
  };
}

function distance(points) {
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

function isLocalTestTileTemplate(value) {
  return typeof value === 'string' && value.startsWith('/test/tiles/');
}

function localTestTilesAvailable() {
  const hostname = globalThis.location?.hostname || '';
  return globalThis.__civgraphUseLocalTileFallback === true
    && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');
}

function getDomLabelLimit(layer) {
  const explicit = Number(layer?.maxDomLabels);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const width = Number(globalThis.innerWidth || 1024);
  const memory = Number(globalThis.navigator?.deviceMemory || 4);
  if (width < 700 || memory <= 2) return 90;
  if (width < 1100 || memory <= 4) return 180;
  return 320;
}

function resolveRuntimeProfile() {
  const width = Number(globalThis.innerWidth || 1024);
  const memory = Number(globalThis.navigator?.deviceMemory || 4);
  const cores = Number(globalThis.navigator?.hardwareConcurrency || 4);
  const dpr = Number(globalThis.devicePixelRatio || 1);
  const reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  const lowEnd = width < 700 || memory <= 2 || cores <= 2;
  const medium = !lowEnd && (width < 1100 || memory <= 4 || cores <= 4);
  const workerCount = lowEnd ? 1 : Math.max(1, Math.min(3, cores - 1));
  return {
    deviceClass: lowEnd ? 'low' : (medium ? 'medium' : 'high'),
    workerCount,
    maxTileCacheSize: lowEnd ? 80 : (medium ? 140 : 260),
    maxParallelImageRequests: lowEnd ? 8 : (medium ? 12 : 16),
    fadeDuration: (lowEnd || reducedMotion) ? 0 : 100,
    pixelRatio: lowEnd ? Math.min(dpr, 1.5) : Math.min(dpr, 2),
    reducedMotion
  };
}

function resolveFillOpacity(layer) {
  return clamp(layer?.style?.fillOpacity ?? DEFAULT_VECTOR_FILL_OPACITY, 0, 1);
}

function resolveLayerOpacity(layer) {
  if (layer?.sourceType === 'raster' || layer?.sourceType === 'image') {
    return clamp(layer.rasterOpacity ?? layer.style?.opacity ?? 0.85, 0, 1);
  }
  return resolveFillOpacity(layer);
}

export class TestMapLibreController {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.map = null;
    this.maplibreVersion = maplibregl.version;
    this.protocol = new Protocol({ metadata: true });
    this.layers = new Map();
    this.selected = null;
    this.hovered = null;
    this.metrics = [];
    this.fallbackLayers = new Map();
    this.interactionCleanups = new Map();
    this.fallbackCleanups = new Map();
    this.duplicateFeatureIdCache = new Map();
    this.pmtilesArchiveCache = new Map();
    this.runtimeProfile = resolveRuntimeProfile();
    this.mobileGestureGuardInstalled = false;
    this.mobileGestureGuardTargetCount = 0;
    this.mobileGestureResizeObserver = null;
    this.mobileGestureResizeFrame = 0;
    this.mobileGestureResizeSize = null;
    this.directGestureActive = false;
    this.directPanGestureInstalled = false;
    this.directPanGestureState = null;
    this.directPanFrame = 0;
    this.directPanPendingCenter = null;
    this.directWheelGestureInstalled = false;
    this.directWheelFrame = 0;
    this.directWheelPendingZoom = null;
    this.directWheelEndTimer = 0;
    this.directTwoFingerGestureInstalled = false;
    this.directTwoFingerGestureState = null;
    this.directTwoFingerGestureFrame = 0;
    this.directTwoFingerGesturePending = null;
    maplibregl.addProtocol('pmtiles', this.protocol.tile);
  }

  init() {
    if (Number.isFinite(this.runtimeProfile.workerCount)) {
      maplibregl.workerCount = this.runtimeProfile.workerCount;
    }
    if (Number.isFinite(this.runtimeProfile.maxParallelImageRequests)) {
      maplibregl.maxParallelImageRequests = this.runtimeProfile.maxParallelImageRequests;
    }
    this.map = new maplibregl.Map({
      container: this.container,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      },
      center: [-8.05, 53.4],
      zoom: 5.8,
      minZoom: 4,
      maxZoom: 16,
      attributionControl: true,
      fadeDuration: this.runtimeProfile.fadeDuration,
      maxTileCacheSize: this.runtimeProfile.maxTileCacheSize,
      pixelRatio: this.runtimeProfile.pixelRatio,
      refreshExpiredTiles: false,
      renderWorldCopies: false,
      interactive: true,
      dragRotate: true,
      dragPan: true,
      touchZoomRotate: true,
      touchPitch: true,
      pitchWithRotate: true,
      scrollZoom: true,
      cooperativeGestures: false
    });

    this.recordMetric({
      event: 'runtime-profile',
      profile: this.runtimeProfile
    });

    this.map.doubleClickZoom?.disable();
    this.enableGestureHandlers();
    this.installMobileGestureGuards();
    this.installDirectPanGestureFallback();
    this.installDirectWheelGestureFallback();
    this.installDirectTwoFingerGestureFallback();
    this.applyMobileTouchContract();
    this.map.on('load', () => {
      this.enableGestureHandlers();
      this.applyMobileTouchContract();
    });
    this.map.on('styledata', () => {
      this.enableGestureHandlers();
      this.applyMobileTouchContract();
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    this.map.on('moveend', () => {
      if (!this.directGestureActive) this.notifyChange();
    });
    this.map.on('idle', () => this.notifyChange());
    this.map.fitBounds(IRELAND_BOUNDS, { padding: 28, duration: 0 });
  }

  resetDirectPanGestureState(target = null, pointerId = null) {
    if (this.directPanFrame) {
      cancelAnimationFrame(this.directPanFrame);
      this.directPanFrame = 0;
    }
    this.directPanPendingCenter = null;
    const state = this.directPanGestureState;
    if (state) {
      const releaseTarget = target || state.target || this.map?.getContainer?.();
      const releasePointerId = pointerId ?? state.pointerId;
      try {
        if (releaseTarget?.hasPointerCapture?.(releasePointerId)) {
          releaseTarget.releasePointerCapture(releasePointerId);
        }
      } catch {
        // Ignore browsers that throw after implicit release.
      }
    }
    this.directPanGestureState = null;
  }

  enableGestureHandlers() {
    if (!this.map) return;
    this.map.dragPan?.enable?.();
    this.map.dragRotate?.enable?.();
    this.map.touchZoomRotate?.enable?.({ around: 'center' });
    this.map.touchZoomRotate?.enableRotation?.();
    this.map.touchPitch?.enable?.({ around: 'center' });
    this.map.scrollZoom?.enable?.();
    this.map.keyboard?.enable?.();
    this.applyMobileTouchContract();
  }

  installMobileGestureGuards() {
    if (!this.map || this.mobileGestureGuardInstalled) return;
    const root = this.map.getContainer?.();
    if (!root?.addEventListener) return;
    this.mobileGestureGuardInstalled = true;
    const preventBrowserMapGesture = (event) => {
      if (isMobileGestureChromeTarget(event.target)) return;
      if (event.cancelable) event.preventDefault();
    };
    const refreshTouchContract = (event) => {
      if (isMobileGestureChromeTarget(event.target)) return;
      this.applyMobileTouchContract();
    };
    const guardTargets = new Set([
      root,
      this.map.getCanvasContainer?.()
    ].filter(Boolean));
    const nonPassive = { passive: false };
    const passive = { passive: true };
    for (const target of guardTargets) {
      target.addEventListener('touchstart', refreshTouchContract, passive);
      target.addEventListener('gesturestart', preventBrowserMapGesture, nonPassive);
      target.addEventListener('gesturechange', preventBrowserMapGesture, nonPassive);
      target.addEventListener('gestureend', preventBrowserMapGesture, nonPassive);
    }
    this.mobileGestureGuardTargetCount = guardTargets.size;
    this.installMobileGestureResizeObserver(root);
  }

  installDirectPanGestureFallback() {
    if (!this.map || this.directPanGestureInstalled) return;
    const root = this.map.getContainer?.();
    if (!root?.addEventListener) return;
    this.directPanGestureInstalled = true;

    const captureOptions = { passive: false, capture: true };
    const applyPendingPan = () => {
      this.directPanFrame = 0;
      const nextCenter = this.directPanPendingCenter;
      this.directPanPendingCenter = null;
      if (!nextCenter || !this.map) return;
      this.map.jumpTo({ center: nextCenter });
    };
    const schedulePan = (nextCenter) => {
      this.directPanPendingCenter = nextCenter;
      if (this.directPanFrame) return;
      this.directPanFrame = requestAnimationFrame(applyPendingPan);
    };
    const flushPan = () => {
      if (this.directPanFrame) {
        cancelAnimationFrame(this.directPanFrame);
        this.directPanFrame = 0;
      }
      applyPendingPan();
    };
    const begin = (event) => {
      if (isMobileGestureChromeTarget(event.target)) return;
      if (event.button !== undefined && event.button !== 0) return;
      if (this.directPanGestureState && event.pointerType === 'touch') {
        this.directPanGestureState.cancelled = true;
        return;
      }
      if (this.directPanGestureState || event.isPrimary === false) return;
      const center = this.map.getCenter();
      this.directPanGestureState = {
        pointerId: event.pointerId,
        pointerType: event.pointerType || 'mouse',
        startX: event.clientX,
        startY: event.clientY,
        center,
        moved: false,
        cancelled: false,
        captured: false,
        target: event.currentTarget || root
      };
    };
    const move = (event) => {
      const state = this.directPanGestureState;
      if (!state || state.cancelled || event.pointerId !== state.pointerId) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (!state.moved && Math.hypot(dx, dy) < 3) return;
      state.moved = true;
      if (!state.captured) {
        try {
          event.currentTarget?.setPointerCapture?.(event.pointerId);
          state.captured = true;
        } catch {
          // Pointer capture is best-effort; document-level pointerup still clears state.
        }
      }
      this.directGestureActive = true;
      const centerPoint = this.map.project(state.center);
      const nextCenter = this.map.unproject([centerPoint.x - dx, centerPoint.y - dy]);
      schedulePan(nextCenter);
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };
    const end = (event) => {
      const state = this.directPanGestureState;
      if (!state || (event?.pointerId !== undefined && event.pointerId !== state.pointerId)) return;
      if (state.moved) {
        flushPan();
        if (event?.cancelable) event.preventDefault();
        event?.stopPropagation?.();
        this.directGestureActive = false;
        this.notifyChange();
      }
      this.resetDirectPanGestureState(event?.currentTarget || root, state.pointerId);
    };

    root.addEventListener('pointerdown', begin, captureOptions);
    root.addEventListener('pointermove', move, captureOptions);
    root.addEventListener('pointerup', end, captureOptions);
    root.addEventListener('pointercancel', end, captureOptions);
    root.addEventListener('lostpointercapture', end, captureOptions);
    document.addEventListener('pointerup', end, captureOptions);
    document.addEventListener('pointercancel', end, captureOptions);
  }

  installDirectWheelGestureFallback() {
    if (!this.map || this.directWheelGestureInstalled) return;
    const root = this.map.getContainer?.();
    if (!root?.addEventListener) return;
    this.directWheelGestureInstalled = true;

    const applyPendingWheel = () => {
      this.directWheelFrame = 0;
      const zoom = this.directWheelPendingZoom;
      this.directWheelPendingZoom = null;
      if (!Number.isFinite(zoom) || !this.map) return;
      this.map.jumpTo({ zoom });
    };
    const scheduleWheelEnd = () => {
      if (this.directWheelEndTimer) clearTimeout(this.directWheelEndTimer);
      this.directWheelEndTimer = setTimeout(() => {
        this.directWheelEndTimer = 0;
        this.directGestureActive = false;
        this.notifyChange();
      }, 140);
    };
    const onWheel = (event) => {
      if (isMobileGestureChromeTarget(event.target)) return;
      const scale = event.deltaMode === 1
        ? 40
        : (event.deltaMode === 2 ? Math.max(1, globalThis.innerHeight || 800) : 1);
      const deltaY = Number(event.deltaY || 0) * scale;
      if (!Number.isFinite(deltaY) || deltaY === 0) return;
      const minZoom = typeof this.map.getMinZoom === 'function' ? this.map.getMinZoom() : 0;
      const maxZoom = typeof this.map.getMaxZoom === 'function' ? this.map.getMaxZoom() : 22;
      const baseZoom = Number.isFinite(this.directWheelPendingZoom) ? this.directWheelPendingZoom : this.map.getZoom();
      this.directWheelPendingZoom = clamp(baseZoom - (deltaY / 450), minZoom, maxZoom);
      this.directGestureActive = true;
      if (!this.directWheelFrame) this.directWheelFrame = requestAnimationFrame(applyPendingWheel);
      scheduleWheelEnd();
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    root.addEventListener('wheel', onWheel, { passive: false, capture: true });
  }

  installDirectTwoFingerGestureFallback() {
    if (!this.map || this.directTwoFingerGestureInstalled) return;
    const root = this.map.getContainer?.();
    if (!root?.addEventListener) return;
    this.directTwoFingerGestureInstalled = true;

    const captureOptions = { passive: false, capture: true };
    const blockBrowserGesture = (event) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };
    const applyPendingTwoFingerGesture = () => {
      this.directTwoFingerGestureFrame = 0;
      const next = this.directTwoFingerGesturePending;
      this.directTwoFingerGesturePending = null;
      if (!next || !this.map) return;
      this.map.jumpTo(next);
    };
    const scheduleTwoFingerGesture = (next) => {
      this.directTwoFingerGesturePending = next;
      if (this.directTwoFingerGestureFrame) return;
      this.directTwoFingerGestureFrame = requestAnimationFrame(applyPendingTwoFingerGesture);
    };
    const flushTwoFingerGesture = () => {
      if (this.directTwoFingerGestureFrame) {
        cancelAnimationFrame(this.directTwoFingerGestureFrame);
        this.directTwoFingerGestureFrame = 0;
      }
      applyPendingTwoFingerGesture();
    };
    const begin = (event) => {
      if (isMobileGestureChromeTarget(event.target)) return false;
      const points = firstTwoTouchPoints(event);
      if (!points) return false;
      const initialDistance = distance(points);
      if (!Number.isFinite(initialDistance) || initialDistance <= 0) return false;
      this.resetDirectPanGestureState(root);
      this.directTwoFingerGestureState = {
        distance: initialDistance,
        midpoint: midpoint(points),
        zoom: this.map.getZoom(),
        pitch: this.map.getPitch()
      };
      blockBrowserGesture(event);
      return true;
    };
    const move = (event) => {
      if (isMobileGestureChromeTarget(event.target)) return;
      const points = firstTwoTouchPoints(event);
      if (!points) return;
      if (!this.directTwoFingerGestureState && !begin(event)) return;
      const state = this.directTwoFingerGestureState;
      const nextDistance = distance(points);
      if (!state || !Number.isFinite(nextDistance) || nextDistance <= 0) return;
      const nextMidpoint = midpoint(points);
      const minZoom = typeof this.map.getMinZoom === 'function' ? this.map.getMinZoom() : 0;
      const maxZoom = typeof this.map.getMaxZoom === 'function' ? this.map.getMaxZoom() : 22;
      const scale = nextDistance / state.distance;
      const zoom = clamp(state.zoom + Math.log2(Math.max(scale, 0.01)), minZoom, maxZoom);
      const pitch = clamp(state.pitch - ((nextMidpoint.y - state.midpoint.y) * 0.22), 0, 60);
      this.directGestureActive = true;
      scheduleTwoFingerGesture({ zoom, pitch });
      blockBrowserGesture(event);
    };
    const end = (event) => {
      if (!this.directTwoFingerGestureState) return;
      if (event.touches && event.touches.length >= 2) return;
      flushTwoFingerGesture();
      this.directTwoFingerGestureState = null;
      this.resetDirectPanGestureState(root);
      this.enableGestureHandlers();
      this.directGestureActive = false;
      this.notifyChange();
      blockBrowserGesture(event);
    };

    root.addEventListener('touchstart', begin, captureOptions);
    root.addEventListener('touchmove', move, captureOptions);
    root.addEventListener('touchend', end, captureOptions);
    root.addEventListener('touchcancel', end, captureOptions);
  }

  installMobileGestureResizeObserver(root) {
    if (!this.map || this.mobileGestureResizeObserver || typeof ResizeObserver === 'undefined') return;
    const readSize = (entry) => {
      const box = Array.isArray(entry?.borderBoxSize) ? entry.borderBoxSize[0] : entry?.borderBoxSize;
      const width = Number(box?.inlineSize);
      const height = Number(box?.blockSize);
      if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
      const rect = root.getBoundingClientRect?.();
      if (!rect) return null;
      return { width: rect.width, height: rect.height };
    };
    const sizeChanged = (next) => {
      const previous = this.mobileGestureResizeSize;
      this.mobileGestureResizeSize = next;
      if (!previous) return false;
      return Math.abs(next.width - previous.width) > 0.5 || Math.abs(next.height - previous.height) > 0.5;
    };
    const scheduleRefresh = (entries = []) => {
      const nextSize = readSize(entries[0]);
      this.applyMobileTouchContract();
      if (!nextSize || !sizeChanged(nextSize)) return;
      if (this.mobileGestureResizeFrame) return;
      this.mobileGestureResizeFrame = requestAnimationFrame(() => {
        this.mobileGestureResizeFrame = 0;
        this.applyMobileTouchContract();
        this.map?.resize?.();
      });
    };
    this.mobileGestureResizeObserver = new ResizeObserver(scheduleRefresh);
    this.mobileGestureResizeObserver.observe(root);
  }

  applyMobileTouchContract() {
    if (!this.map) return;
    const elements = [
      document.getElementById(typeof this.container === 'string' ? this.container : ''),
      this.map.getContainer?.(),
      this.map.getCanvasContainer?.(),
      this.map.getCanvas?.()
    ].filter(Boolean);
    for (const element of new Set(elements)) {
      element.style.touchAction = 'none';
      element.style.overscrollBehavior = 'contain';
      element.style.userSelect = 'none';
      element.style.webkitUserSelect = 'none';
      element.style.webkitTouchCallout = 'none';
      element.style.webkitOverflowScrolling = 'auto';
    }
    const canvas = this.map.getCanvas?.();
    if (canvas) canvas.style.pointerEvents = 'auto';
  }

  getMobileGestureDiagnostics() {
    if (!this.map) return null;
    this.applyMobileTouchContract();
    const canvas = this.map.getCanvas?.();
    const canvasContainer = this.map.getCanvasContainer?.();
    const root = this.map.getContainer?.();
    const rect = canvas?.getBoundingClientRect?.();
    const x = rect ? rect.left + rect.width * 0.5 : 0;
    const y = rect ? rect.top + rect.height * 0.5 : 0;
    const top = rect ? document.elementFromPoint(x, y) : null;
    return {
      topTag: top?.tagName || '',
      topClass: top?.className ? String(top.className) : '',
      topIsCanvas: top === canvas,
      topWithinMap: Boolean(top?.closest?.('#map')),
      topWithinCanvasContainer: Boolean(canvasContainer?.contains?.(top)),
      rootTouchAction: root ? getComputedStyle(root).touchAction : '',
      canvasTouchAction: canvas ? getComputedStyle(canvas).touchAction : '',
      canvasContainerTouchAction: canvasContainer ? getComputedStyle(canvasContainer).touchAction : '',
      dragPanEnabled: typeof this.map.dragPan?.isEnabled === 'function' ? this.map.dragPan.isEnabled() : true,
      scrollZoomEnabled: typeof this.map.scrollZoom?.isEnabled === 'function' ? this.map.scrollZoom.isEnabled() : true,
      dragRotateEnabled: typeof this.map.dragRotate?.isEnabled === 'function' ? this.map.dragRotate.isEnabled() : true,
      touchZoomEnabled: typeof this.map.touchZoomRotate?.isEnabled === 'function' ? this.map.touchZoomRotate.isEnabled() : true,
      touchPitchEnabled: typeof this.map.touchPitch?.isEnabled === 'function' ? this.map.touchPitch.isEnabled() : true,
      guardTargetCount: this.mobileGestureGuardTargetCount || 0,
      resizeObserverTargets: this.mobileGestureResizeObserver ? 1 : 0,
      directPanGestureInstalled: this.directPanGestureInstalled,
      directWheelGestureInstalled: this.directWheelGestureInstalled,
      directTwoFingerGestureInstalled: this.directTwoFingerGestureInstalled
    };
  }

  async loadLayer(layer) {
    if (layer.loadable === false || layer.sourceType === 'unconverted') {
      throw new Error(`${layer.name} is not yet converted for the /test MapLibre renderer`);
    }
    if (this.layers.has(layer.id)) {
      this.fitToLayer(layer.id);
      return;
    }

    const started = performance.now();
    const sourceId = `${layer.id}-source`;
    const fillId = `${layer.id}-fill`;
    const lineId = `${layer.id}-line`;
    const rasterId = `${layer.id}-raster`;
    const hoverId = `${layer.id}-hover`;
    const hoverLineId = `${layer.id}-hover-line`;
    const selectedFillId = `${layer.id}-selected-fill`;
    const selectedId = `${layer.id}-selected`;
    const labelId = `${layer.id}-label`;

    await this.waitForMap();
    const duplicateFeatureIds = await this.loadDuplicateFeatureIds(layer);

    const source = this.buildSource(layer);
    this.map.addSource(sourceId, source);
    let interactionOverlayIds = { layerIds: [], sourceIds: [] };
    if (layer.sourceType === 'raster' || layer.sourceType === 'image') {
      this.addRasterLayer(layer, { sourceId, rasterId });
    } else {
      this.addGeometryLayers(layer, { sourceId, fillId, lineId, hoverId, selectedFillId, selectedId });
      interactionOverlayIds = this.addInteractionOverlayLayers(layer);
    }
    const labelLayerIds = this.addLabelLayers(layer, { sourceId, labelId });

    this.layers.set(layer.id, {
      config: layer,
      sourceId,
      sourceIds: [sourceId, ...interactionOverlayIds.sourceIds],
      layerIds: [
        fillId,
        lineId,
        hoverId,
        hoverLineId,
        selectedFillId,
        selectedId,
        ...interactionOverlayIds.layerIds,
        labelId,
        rasterId
      ].filter((id) => this.map.getLayer(id)),
      labelLayerIds,
      domLabelMarkers: new Map(),
      domLabelsScheduled: 0,
      duplicateFeatureIds,
      labelsEnabled: true,
      textScale: DEFAULT_TEXT_SCALE,
      opacity: resolveLayerOpacity(layer),
      color: layer.style?.color || '#5B21B6',
      fillColor: layer.style?.fillColor || layer.style?.color || '#7C3AED'
    });
    this.applySavedLayerPreferences(layer.id);

    if (layer.sourceType !== 'raster' && layer.sourceType !== 'image') {
      this.interactionCleanups.set(layer.id, this.bindLayerInteractions(layer, fillId, labelId, sourceId));
      this.scheduleDomLabelRefresh(layer.id);
    }
    if (layer.sourceType === 'pmtiles') {
      this.fallbackCleanups.set(layer.id, this.monitorPmtilesFallback(layer, sourceId));
    }
    this.reorderFromSavedLayerOrder();
    this.fitToLayer(layer.id);
    this.recordMetric({
      layerId: layer.id,
      layerName: layer.name,
      event: 'load',
      durationMs: Math.round(performance.now() - started),
      sourceType: layer.sourceType
    });
    this.notifyChange();
  }

  addRasterLayer(layer, ids) {
    this.map.addLayer({
      id: ids.rasterId,
      type: 'raster',
      source: ids.sourceId,
      paint: {
        'raster-opacity': clamp(layer.rasterOpacity ?? layer.style?.opacity ?? 0.85, 0, 1)
      }
    });
  }

  addGeometryLayers(layer, ids) {
    const { sourceId, fillId, lineId, hoverId, selectedFillId, selectedId } = ids;
    if (layer.geometryType !== 'line' && layer.geometryType !== 'point') {
      this.map.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'fill-color': layer.style?.fillColor || layer.style?.color || '#7C3AED',
          'fill-opacity': resolveFillOpacity(layer),
          'fill-antialias': false
        }
      });
    }

    this.map.addLayer({
      id: lineId,
      type: layer.geometryType === 'point' ? 'circle' : 'line',
      source: sourceId,
      'source-layer': layer.sourceLayer,
      paint: layer.geometryType === 'point' ? {
        'circle-color': layer.style?.color || '#5B21B6',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 12, 6],
        'circle-opacity': 0.88
      } : {
        'line-color': layer.style?.color || '#5B21B6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, Math.max(0.4, Number(layer.style?.weight || 1) * 0.55), 12, Math.max(0.8, Number(layer.style?.weight || 1) * 1.4)],
        'line-opacity': 0.88
      }
    });

    if (layer.geometryType === 'point') {
      this.map.addLayer({
        id: hoverId,
        type: 'circle',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'circle-color': INTERACTION_FILL_COLOR,
          'circle-stroke-color': INTERACTION_STROKE_COLOR,
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0],
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 7, 0],
          'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0]
        }
      });
    } else if (layer.geometryType === 'line') {
      this.map.addLayer({
        id: hoverId,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': INTERACTION_STROKE_COLOR,
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 0],
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0]
        }
      });
    } else {
      this.map.addLayer({
        id: hoverId,
        type: 'fill',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'fill-color': INTERACTION_FILL_COLOR,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.42, 0],
          'fill-antialias': false
        }
      });
    }

    if (layer.geometryType === 'point') {
      this.map.addLayer({
        id: selectedId,
        type: 'circle',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'circle-color': INTERACTION_FILL_COLOR,
          'circle-stroke-color': INTERACTION_STROKE_COLOR,
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 0],
          'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 8, 0],
          'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.95, 0]
        }
      });
      return;
    }

    if (layer.geometryType !== 'line') {
      this.map.addLayer({
        id: selectedFillId,
        type: 'fill',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'fill-color': INTERACTION_FILL_COLOR,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.42, 0],
          'fill-antialias': false
        }
      });
      return;
    }
    this.map.addLayer({
      id: selectedId,
      type: 'line',
      source: sourceId,
      'source-layer': layer.sourceLayer,
      paint: {
        'line-color': INTERACTION_STROKE_COLOR,
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 0],
        'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.95, 0]
      }
    });
  }

  addInteractionOverlayLayers(layer) {
    const hoverSourceId = `${layer.id}-fallback-hover-source`;
    const selectedSourceId = `${layer.id}-fallback-selected-source`;
    this.map.addSource(hoverSourceId, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
    this.map.addSource(selectedSourceId, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
    const layerIds = [];
    const sourceIds = [hoverSourceId, selectedSourceId];
    const addPointLayer = (id, source, radius) => {
      this.map.addLayer({
        id,
        type: 'circle',
        source,
        paint: {
          'circle-color': INTERACTION_FILL_COLOR,
          'circle-stroke-color': INTERACTION_STROKE_COLOR,
          'circle-stroke-width': 2.5,
          'circle-radius': radius,
          'circle-opacity': 0.95
        }
      });
      layerIds.push(id);
    };
    const addLineLayer = (id, source, width = 3) => {
      this.map.addLayer({
        id,
        type: 'line',
        source,
        paint: {
          'line-color': INTERACTION_STROKE_COLOR,
          'line-width': width,
          'line-opacity': 0.95
        }
      });
      layerIds.push(id);
    };
    const addFillLayer = (id, source) => {
      this.map.addLayer({
        id,
        type: 'fill',
        source,
        paint: {
          'fill-color': INTERACTION_FILL_COLOR,
          'fill-opacity': 0.42,
          'fill-antialias': false
        }
      });
      layerIds.push(id);
    };

    if (layer.geometryType === 'point') {
      addPointLayer(`${layer.id}-fallback-hover`, hoverSourceId, 7);
      addPointLayer(`${layer.id}-fallback-selected`, selectedSourceId, 8);
    } else if (layer.geometryType === 'line') {
      addLineLayer(`${layer.id}-fallback-hover`, hoverSourceId, 3);
      addLineLayer(`${layer.id}-fallback-selected`, selectedSourceId, 3);
    } else {
      // Polygon vector-tile features are clipped at tile boundaries. Drawing
      // interaction strokes from those fragments exposes internal tile seams,
      // so polygon interaction uses fill + DOM-label state unless full
      // unclipped outline geometry is available.
      addFillLayer(`${layer.id}-fallback-hover-fill`, hoverSourceId);
      addFillLayer(`${layer.id}-fallback-selected-fill`, selectedSourceId);
    }
    return { layerIds, sourceIds };
  }

  addLabelLayers(layer, ids) {
    if (!layer.labelProperty) return [];
    const { sourceId, labelId } = ids;
    const labelMinZoom = getLabelMinZoom(layer);
    const labelMaxZoom = getLabelMaxZoom(layer);
    const labelStyle = getLabelStyle(layer);
    this.map.addLayer({
      id: labelId,
      type: 'symbol',
      source: sourceId,
      'source-layer': layer.sourceLayer,
      minzoom: labelMinZoom,
      maxzoom: labelMaxZoom,
      filter: buildLabelFilter(layer),
      layout: {
        'text-field': buildLabelTextExpression(layer),
        'text-size': buildLabelTextSizeExpression(layer, DEFAULT_TEXT_SCALE),
        'text-font': buildLabelFontStack(labelStyle),
        'text-max-width': labelStyle.maxWidth,
        'text-line-height': labelStyle.lineHeight,
        'text-justify': 'center',
        'text-padding': 2,
        'text-allow-overlap': Boolean(layer.labelAllowOverlap),
        'text-ignore-placement': Boolean(layer.labelIgnorePlacement),
        'symbol-sort-key': buildLabelSortExpression(layer)
      },
      paint: {
        'text-color': buildLabelColorExpression(layer),
        'text-halo-color': labelStyle.haloColor,
        'text-halo-width': labelStyle.haloWidth,
        'text-halo-blur': labelStyle.haloBlur,
        'text-opacity': 0
      }
    });
    return [labelId];
  }

  unloadLayer(layerId) {
    const record = this.layers.get(layerId);
    if (!record) return;
    this.clearFeatureState(this.hovered, 'hover');
    this.clearFeatureState(this.selected, 'selected');
    this.interactionCleanups.get(layerId)?.();
    this.interactionCleanups.delete(layerId);
    this.fallbackCleanups.get(layerId)?.();
    this.fallbackCleanups.delete(layerId);
    this.clearDomLabels(layerId);
    for (const layerIdToRemove of [...record.layerIds].reverse()) {
      if (this.map.getLayer(layerIdToRemove)) this.map.removeLayer(layerIdToRemove);
    }
    for (const sourceId of [...(record.sourceIds || []), record.sourceId]) {
      if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
    }
    this.layers.delete(layerId);
    if (this.selected?.layerId === layerId) {
      this.selected = null;
      this.options.onSelection?.(null);
    }
    this.notifyChange();
  }

  setOpacity(layerId, opacity) {
    const record = this.layers.get(layerId);
    if (!record) return;
    record.opacity = clamp(opacity, 0, 1);
    const fillId = `${layerId}-fill`;
    const lineId = `${layerId}-line`;
    const rasterId = `${layerId}-raster`;
    if (this.map.getLayer(rasterId)) this.map.setPaintProperty(rasterId, 'raster-opacity', record.opacity);
    if (this.map.getLayer(fillId)) this.map.setPaintProperty(fillId, 'fill-opacity', record.opacity);
    if (this.map.getLayer(lineId)) {
      const property = record.config.geometryType === 'point' ? 'circle-opacity' : 'line-opacity';
      this.map.setPaintProperty(lineId, property, clamp(record.opacity + 0.35, 0, 1));
    }
    this.notifyChange();
  }

  setLayerColor(layerId, color) {
    const record = this.layers.get(layerId);
    if (!record || !isColor(color)) return;
    record.color = color;
    const lineId = `${layerId}-line`;
    if (this.map.getLayer(lineId)) {
      const property = record.config.geometryType === 'point' ? 'circle-color' : 'line-color';
      this.map.setPaintProperty(lineId, property, color);
    }
    this.notifyChange();
  }

  setLayerFillColor(layerId, color) {
    const record = this.layers.get(layerId);
    if (!record || !isColor(color)) return;
    record.fillColor = color;
    const fillId = `${layerId}-fill`;
    if (this.map.getLayer(fillId)) this.map.setPaintProperty(fillId, 'fill-color', color);
    this.notifyChange();
  }

  setLayerStrokeWidth(layerId, width) {
    const record = this.layers.get(layerId);
    if (!record) return;
    const lineId = `${layerId}-line`;
    if (!this.map.getLayer(lineId)) return;
    const value = clamp(width, 0.2, 8);
    if (record.config.geometryType === 'point') {
      this.map.setPaintProperty(lineId, 'circle-radius', value);
    } else {
      this.map.setPaintProperty(lineId, 'line-width', value);
    }
    record.strokeWidth = value;
    this.notifyChange();
  }

  setLayerAttributeFilter(layerId, attribute, value) {
    const record = this.layers.get(layerId);
    if (!record || !attribute) return false;
    const filter = value === undefined || value === null || value === ''
      ? null
      : ['==', ['to-string', ['get', attribute]], String(value)];
    for (const layerIdToFilter of record.layerIds || []) {
      if (!this.map.getLayer(layerIdToFilter) || /label|hover|selected/i.test(layerIdToFilter)) continue;
      this.map.setFilter(layerIdToFilter, filter);
    }
    record.attributeFilter = filter ? { attribute, value: String(value) } : null;
    this.notifyChange();
    return true;
  }

  clearLayerFilter(layerId) {
    const record = this.layers.get(layerId);
    if (!record) return false;
    for (const layerIdToFilter of record.layerIds || []) {
      if (!this.map.getLayer(layerIdToFilter) || /label|hover|selected/i.test(layerIdToFilter)) continue;
      this.map.setFilter(layerIdToFilter, null);
    }
    record.attributeFilter = null;
    this.notifyChange();
    return true;
  }

  setLayerLabelsEnabled(layerId, enabled) {
    const record = this.layers.get(layerId);
    if (!record) return;
    record.labelsEnabled = Boolean(enabled);
    const visibility = record.labelsEnabled ? 'visible' : 'none';
    for (const labelLayerId of record.labelLayerIds || []) {
      if (this.map.getLayer(labelLayerId)) this.map.setLayoutProperty(labelLayerId, 'visibility', visibility);
    }
    for (const marker of record.domLabelMarkers?.values?.() || []) {
      marker.getElement().hidden = !record.labelsEnabled;
    }
    this.notifyChange();
  }

  setLayerTextScale(layerId, scale) {
    const record = this.layers.get(layerId);
    if (!record) return;
    record.textScale = clamp(scale, 50, 200);
    for (const labelLayerId of record.labelLayerIds || []) {
      if (this.map.getLayer(labelLayerId)) {
        this.map.setLayoutProperty(labelLayerId, 'text-size', buildLabelTextSizeExpression(record.config, record.textScale));
      }
    }
    this.scheduleDomLabelRefresh(layerId);
    this.notifyChange();
  }

  moveLayerOrder(layerId, delta) {
    if (!this.layers.has(layerId) || !delta) return false;
    const entries = [...this.layers.entries()];
    const index = entries.findIndex(([id]) => id === layerId);
    const next = index + delta;
    if (next < 0 || next >= entries.length) return false;
    const [entry] = entries.splice(index, 1);
    entries.splice(next, 0, entry);
    this.layers = new Map(entries);
    this.reapplyLayerOrder();
    writeLayerOrder([...this.layers.keys()]);
    this.notifyChange();
    return true;
  }

  moveLayerBefore(layerId, beforeLayerId) {
    if (!this.layers.has(layerId) || !this.layers.has(beforeLayerId) || layerId === beforeLayerId) return false;
    const entries = [...this.layers.entries()];
    const index = entries.findIndex(([id]) => id === layerId);
    const beforeIndex = entries.findIndex(([id]) => id === beforeLayerId);
    if (index < 0 || beforeIndex < 0) return false;
    const [entry] = entries.splice(index, 1);
    const targetIndex = entries.findIndex(([id]) => id === beforeLayerId);
    entries.splice(targetIndex < 0 ? beforeIndex : targetIndex, 0, entry);
    this.layers = new Map(entries);
    this.reapplyLayerOrder();
    writeLayerOrder([...this.layers.keys()]);
    this.notifyChange();
    return true;
  }

  reorderFromSavedLayerOrder() {
    const order = readLayerOrder();
    if (!order.length || this.layers.size < 2) return;
    const ranked = new Map(order.map((id, index) => [id, index]));
    const entries = [...this.layers.entries()].sort((a, b) => {
      const rankA = ranked.has(a[0]) ? ranked.get(a[0]) : Number.MAX_SAFE_INTEGER;
      const rankB = ranked.has(b[0]) ? ranked.get(b[0]) : Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    });
    this.layers = new Map(entries);
    this.reapplyLayerOrder();
  }

  reapplyLayerOrder() {
    for (const record of this.layers.values()) {
      for (const id of record.layerIds || []) {
        if (this.map.getLayer(id)) this.map.moveLayer(id);
      }
    }
  }

  applySavedLayerPreferences(layerId) {
    const saved = readLayerPreferences(layerId);
    if (!saved) return;
    if (saved.opacity !== undefined) this.setOpacity(layerId, Number(saved.opacity));
    if (saved.strokeWidth !== undefined) this.setLayerStrokeWidth(layerId, Number(saved.strokeWidth));
    if (saved.color) this.setLayerColor(layerId, saved.color);
    if (saved.fillColor) this.setLayerFillColor(layerId, saved.fillColor);
    if (saved.labelsEnabled !== undefined) this.setLayerLabelsEnabled(layerId, Boolean(saved.labelsEnabled));
    if (saved.textScale !== undefined) this.setLayerTextScale(layerId, Number(saved.textScale));
  }

  selectFeatureById(layerId, featureId, properties = {}) {
    const record = this.layers.get(layerId);
    if (!record || featureId === undefined || featureId === null || record.config.sourceType === 'raster') return false;
    this.setDomLabelSelected(this.selected?.layerId, this.selected?.id, false);
    this.clearFeatureState(this.selected, 'selected');
    this.selected = {
      layerId,
      sourceId: record.sourceId,
      sourceLayer: record.config.sourceLayer,
      id: featureId,
      properties
    };
    this.map.setFeatureState({
      source: record.sourceId,
      sourceLayer: record.config.sourceLayer,
      id: featureId
    }, { selected: true });
    this.setDomLabelSelected(layerId, featureId, true);
    this.options.onSelection?.({ layer: record.config, feature: { id: featureId, properties } });
    this.notifyChange();
    return true;
  }

  fitToLayer(layerId) {
    const record = this.layers.get(layerId);
    if (!record) return;
    this.fitToBounds(record.config.bounds);
  }

  fitToBounds(boundsValue) {
    const bounds = boundsToMapLibre(boundsValue);
    if (bounds) this.map.fitBounds(bounds, { padding: 36, duration: 400 });
  }

  buildSource(layer) {
    if (layer.sourceType === 'pmtiles') {
      if (!layer.tileUrl) throw new Error('missing PMTiles URL');
      if (!this.pmtilesArchiveCache.has(layer.tileUrl)) {
        this.pmtilesArchiveCache.set(layer.tileUrl, new PMTiles(layer.tileUrl));
      }
      this.protocol.add(this.pmtilesArchiveCache.get(layer.tileUrl));
      return { type: 'vector', url: `pmtiles://${layer.tileUrl}`, minzoom: layer.minzoom, maxzoom: layer.maxzoom, promoteId: layer.promoteId };
    }
    if (layer.sourceType === 'mvt') {
      if (!layer.tiles) throw new Error('missing vector tile URL template');
      return { type: 'vector', tiles: [absoluteTileTemplate(layer.tiles)], minzoom: layer.minzoom, maxzoom: layer.maxzoom, bounds: boundsToFlatBbox(layer.bounds), promoteId: layer.promoteId };
    }
    if (layer.sourceType === 'raster') {
      if (!layer.tiles && !layer.tileUrl) throw new Error('missing raster tiles URL template');
      return {
        type: 'raster',
        tiles: [absoluteTileTemplate(layer.tiles || layer.tileUrl)],
        tileSize: layer.tileSize || 256,
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        bounds: boundsToFlatBbox(layer.bounds)
      };
    }
    if (layer.sourceType === 'image') {
      const coordinates = boundsToImageCoordinates(layer.bounds);
      if (!coordinates) throw new Error('missing image bounds');
      if (!layer.imageUrl && !layer.url) throw new Error('missing image URL');
      return {
        type: 'image',
        url: layer.imageUrl || layer.url,
        coordinates
      };
    }
    throw new Error(`unsupported sourceType ${layer.sourceType}`);
  }

  monitorPmtilesFallback(layer, sourceId) {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      this.map.off('error', onError);
    }, 9000);
    const onError = (event) => {
      if (settled || !this.layers.has(layer.id)) return;
      const message = String(event?.error?.message || event?.error || '');
      const sourceMatches = !event.sourceId || event.sourceId === sourceId;
      const looksLikePmtilesFailure = /pmtiles|byte|range|content-length|fetch|network|failed/i.test(message);
      if (!sourceMatches || !looksLikePmtilesFailure) return;
      settled = true;
      clearTimeout(timer);
      this.map.off('error', onError);
      const metric = {
        layerId: layer.id,
        layerName: layer.name,
        event: 'pmtiles-fallback',
        sourceType: 'pmtiles',
        reason: message.slice(0, 240)
      };
      this.recordMetric(metric);
      const fallbackAvailable = layer.tilesFallback && (!isLocalTestTileTemplate(layer.tilesFallback) || localTestTilesAvailable());
      if (!fallbackAvailable) {
        const unavailableMetric = {
          ...metric,
          event: 'pmtiles-fallback-unavailable',
          fallbackUnavailable: true,
          reason: `${metric.reason}${metric.reason ? ' ' : ''}Directory MVT fallback is not deployed on production Pages.`
        };
        this.recordMetric(unavailableMetric);
        this.fallbackLayers.set(layer.id, unavailableMetric);
        this.options.onFallback?.(unavailableMetric);
        return;
      }
      const fallback = {
        ...layer,
        sourceType: 'mvt',
        tiles: layer.tilesFallback,
        tileUrl: undefined,
        fallbackFromPmtiles: true
      };
      this.unloadLayer(layer.id);
      this.loadLayer(fallback).catch((err) => {
        this.recordMetric({
          layerId: layer.id,
          layerName: layer.name,
          event: 'pmtiles-fallback-failed',
          sourceType: 'mvt',
          reason: String(err.message || err).slice(0, 240)
        });
        this.options.onError?.(err);
      });
      this.fallbackLayers.set(layer.id, metric);
      this.options.onFallback?.(metric);
    };
    this.map.on('error', onError);
    return () => {
      settled = true;
      clearTimeout(timer);
      this.map.off('error', onError);
    };
  }

  bindLayerInteractions(layer, fillId, labelId, sourceId) {
    let lastHoverAt = 0;
    let pendingHoverEvent = null;
    let hoverFrame = 0;
    const clearHover = () => this.clearHover();
    const queryAtPoint = (point, radius = 0) => {
      const queryLayers = [fillId, `${layer.id}-line`].filter((id) => id && this.map.getLayer(id));
      if (queryLayers.length === 0) return [];
      const geometry = radius > 0 ? [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]] : point;
      return this.map.queryRenderedFeatures(geometry, { layers: queryLayers });
    };
    const runHoverQuery = () => {
      hoverFrame = 0;
      const event = pendingHoverEvent;
      pendingHoverEvent = null;
      if (!event || !this.layers.has(layer.id)) return;
      const sourceLoaded = typeof this.map.isSourceLoaded === 'function' ? this.map.isSourceLoaded(sourceId) : this.map.areTilesLoaded();
      if (this.map.isMoving() || !sourceLoaded) {
        clearHover();
        return;
      }
      this.setHover(layer, queryAtPoint(event.point)[0]);
    };
    const onMouseMove = (event) => {
      const original = event.originalEvent;
      if (original && document.elementFromPoint(original.clientX, original.clientY)?.closest?.('.maplibre-dom-label')) {
        return;
      }
      pendingHoverEvent = event;
      const now = performance.now();
      if (now - lastHoverAt < HOVER_THROTTLE_MS) {
        if (!hoverFrame) hoverFrame = requestAnimationFrame(runHoverQuery);
        return;
      }
      lastHoverAt = now;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(runHoverQuery);
    };
    const onContainerPointerMove = (event) => {
      const labelElement = event.target?.closest?.('.maplibre-dom-label')
        || document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.maplibre-dom-label');
      if (labelElement?.dataset?.layerId !== layer.id) return;
      const feature = labelElement.__civgraphFeature;
      if (feature) this.setHover(layer, feature);
    };
    const onDoubleClick = (event) => {
      event.preventDefault?.();
      const feature = queryAtPoint(event.point, CLICK_TOLERANCE_PX)[0];
      if (feature) this.selectFeature(layer, feature);
    };
    const onClick = (event) => {
      const original = event.originalEvent;
      if (original && document.elementFromPoint(original.clientX, original.clientY)?.closest?.('.maplibre-dom-label, .maplibregl-ctrl, .map-controls, .active-layers-toggle')) {
        return;
      }
      const feature = queryAtPoint(event.point, CLICK_TOLERANCE_PX)[0];
      if (!feature) {
        this.clearHover();
        return;
      }
      event.preventDefault?.();
      this.selectFeature(layer, feature);
    };
    const onUpdateLabels = () => this.scheduleDomLabelRefresh(layer.id);
    const mapContainer = this.map.getContainer();
    this.map.on('mousemove', onMouseMove);
    this.map.on('click', onClick);
    this.map.on('dblclick', onDoubleClick);
    this.map.on('movestart', clearHover);
    this.map.on('moveend', onUpdateLabels);
    this.map.on('zoomend', onUpdateLabels);
    this.map.on('idle', onUpdateLabels);
    mapContainer.addEventListener('pointermove', onContainerPointerMove, true);
    mapContainer.addEventListener('mouseleave', clearHover);
    return () => {
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      this.map.off('mousemove', onMouseMove);
      this.map.off('click', onClick);
      this.map.off('dblclick', onDoubleClick);
      this.map.off('movestart', clearHover);
      this.map.off('moveend', onUpdateLabels);
      this.map.off('zoomend', onUpdateLabels);
      this.map.off('idle', onUpdateLabels);
      mapContainer.removeEventListener('pointermove', onContainerPointerMove, true);
      mapContainer.removeEventListener('mouseleave', clearHover);
    };
  }

  readFeatureId(layer, feature) {
    return this.readFeatureIdentity(layer, feature).id;
  }

  readFeatureIdentity(layer, feature) {
    const idProperty = layer?.promoteId || 'id';
    const id = feature?.id ?? feature?.properties?.[idProperty] ?? feature?.properties?.id;
    if (id !== undefined && id !== null && id !== '') {
      const duplicateIds = this.layers.get(layer.id)?.duplicateFeatureIds;
      if (duplicateIds?.has(String(id))) {
        const generated = generatedFeatureId(layer, feature) || fallbackGeneratedFeatureId(layer, feature, id);
        return generated ? { id: generated, generated: true, sourceFeatureId: id, duplicatePromoteId: true } : { id, generated: false };
      }
      return { id, generated: false };
    }
    const generated = generatedFeatureId(layer, feature);
    return generated ? { id: generated, generated: true } : { id: null, generated: true };
  }

  async loadDuplicateFeatureIds(layer) {
    if (layer?.featureIdMode === 'unique' || layer?.duplicateFeatureIdCount === 0) return new Set();
    if (Array.isArray(layer?.duplicateFeatureIds)) return new Set(layer.duplicateFeatureIds.map(String));
    const sidecarUrl = layer?.duplicateFeatureIdsUrl;
    if (sidecarUrl) {
      const cacheKey = `sidecar:${sidecarUrl}`;
      if (!this.duplicateFeatureIdCache.has(cacheKey)) {
        this.duplicateFeatureIdCache.set(cacheKey, fetch(sidecarUrl, { cache: 'force-cache' })
          .then((response) => response.ok ? response.json() : null)
          .then((sidecar) => new Set((sidecar?.duplicateFeatureIds || []).map(String)))
          .catch(() => new Set()));
      }
      return this.duplicateFeatureIdCache.get(cacheKey);
    }
    const url = layer?.featureIndexUrl;
    if (!url) return new Set();
    const cacheKey = `index:${url}`;
    if (!this.duplicateFeatureIdCache.has(cacheKey)) {
      this.duplicateFeatureIdCache.set(cacheKey, fetch(url, { cache: 'force-cache' })
        .then((response) => response.ok ? response.json() : null)
        .then((index) => {
          const items = Array.isArray(index)
            ? index
            : (Array.isArray(index?.items) ? index.items : (Array.isArray(index?.features) ? index.features : []));
          const counts = new Map();
          for (const item of items) {
            if (item?.id === undefined || item?.id === null || item.id === '') continue;
            const key = String(item.id);
            counts.set(key, (counts.get(key) || 0) + 1);
          }
          return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
        })
        .catch(() => new Set()));
    }
    return this.duplicateFeatureIdCache.get(cacheKey);
  }

  clearHover() {
    const previous = this.hovered;
    this.clearFeatureState(previous, 'hover');
    this.setDomLabelHover(previous?.layerId, previous?.id, false);
    this.hovered = null;
    if (this.map?.getCanvas) this.map.getCanvas().style.cursor = '';
  }

  setHover(layer, feature) {
    const { id, generated } = this.readFeatureIdentity(layer, feature);
    if (id === null) {
      this.clearHover();
      return;
    }
    if (this.hovered?.layerId === layer.id && this.hovered.id === id) return;
    this.clearHover();
    const record = this.layers.get(layer.id);
    this.hovered = {
      layerId: layer.id,
      sourceId: record?.sourceId,
      sourceLayer: layer.sourceLayer,
      id,
      generated
    };
    this.setDomLabelHover(layer.id, id, true);
    if (!generated) {
      try {
        this.map.setFeatureState({ source: record.sourceId, sourceLayer: layer.sourceLayer, id }, { hover: true });
      } catch {}
    }
    if (generated || layer.geometryType === 'point' || layer.geometryType === 'line') {
      this.setInteractionOverlay(layer.id, 'hover', feature);
    } else {
      this.clearInteractionOverlay(layer.id, 'hover');
    }
    this.map.getCanvas().style.cursor = 'pointer';
  }

  selectFeature(layer, feature) {
    const { id, generated } = this.readFeatureIdentity(layer, feature);
    if (id === null) return false;
    const record = this.layers.get(layer.id);
    if (!record) return false;
    this.setDomLabelSelected(this.selected?.layerId, this.selected?.id, false);
    this.clearFeatureState(this.selected, 'selected');
    const normalizedFeature = {
      ...feature,
      id,
      properties: repairFeatureProperties(layer, feature.properties || {}),
      geometry: feature.geometry || null
    };
    this.selected = {
      layerId: layer.id,
      sourceId: record.sourceId,
      sourceLayer: layer.sourceLayer,
      id,
      generated,
      properties: normalizedFeature.properties
    };
    if (!generated) {
      try {
        this.map.setFeatureState({ source: record.sourceId, sourceLayer: layer.sourceLayer, id }, { selected: true });
      } catch {}
    }
    if (generated || layer.geometryType === 'point' || layer.geometryType === 'line') {
      this.setInteractionOverlay(layer.id, 'selected', normalizedFeature);
    } else {
      this.clearInteractionOverlay(layer.id, 'selected');
    }
    this.setDomLabelSelected(layer.id, id, true);
    this.options.onSelection?.({ layer, feature: normalizedFeature });
    this.notifyChange();
    return true;
  }

  setInteractionOverlay(layerId, state, feature) {
    const record = this.layers.get(layerId);
    const sourceId = `${layerId}-fallback-${state}-source`;
    const source = record && this.map.getSource(sourceId);
    if (!source?.setData) return;
    const geometry = cloneGeometry(feature?.geometry);
    if (!geometry) {
      source.setData(EMPTY_FEATURE_COLLECTION);
      return;
    }
    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry,
        properties: { ...(feature.properties || {}) }
      }]
    });
  }

  clearInteractionOverlay(layerId, state) {
    const source = layerId ? this.map.getSource(`${layerId}-fallback-${state}-source`) : null;
    if (source?.setData) source.setData(EMPTY_FEATURE_COLLECTION);
  }

  scheduleDomLabelRefresh(layerId) {
    const record = this.layers.get(layerId);
    if (!record || !record.config?.labelProperty || record.config.sourceType === 'raster' || record.config.sourceType === 'image') return;
    if (record.domLabelsScheduled) return;
    record.domLabelsScheduled = requestAnimationFrame(() => {
      record.domLabelsScheduled = 0;
      this.refreshDomLabels(layerId);
    });
  }

  refreshDomLabels(layerId) {
    const record = this.layers.get(layerId);
    if (!record || !record.config?.labelProperty) return;
    const layer = record.config;
    const queryLayers = [`${layerId}-fill`, `${layerId}-line`].filter((id) => this.map.getLayer(id));
    const labelMinZoom = Number.isFinite(Number(layer.test2LabelMinZoomOverride))
      ? Number(layer.test2LabelMinZoomOverride)
      : getLabelMinZoom(layer);
    if (!queryLayers.length || !record.labelsEnabled || this.map.getZoom() < labelMinZoom) {
      this.clearDomLabels(layerId);
      return;
    }
    const features = this.map.queryRenderedFeatures({ layers: queryLayers });
    const labelLimit = getDomLabelLimit(layer);
    const nextKeys = new Set();
    const labelBoxes = [];
    for (const feature of features) {
      if (nextKeys.size >= labelLimit) break;
      const id = this.readFeatureId(layer, feature);
      if (id === null) continue;
      const label = getFeatureLabel(layer, feature.properties);
      if (!label) continue;
      const lngLat = featureLabelLngLat(feature);
      if (!lngLat) continue;
      const key = String(id);
      if (nextKeys.has(key)) continue;
      const point = this.map.project(lngLat);
      const box = labelCollisionBox(point, label);
      if (labelBoxes.some((existing) => boxesOverlap(existing, box))) continue;
      labelBoxes.push(box);
      nextKeys.add(key);
      let marker = record.domLabelMarkers.get(key);
      if (!marker) {
        marker = this.createDomLabelMarker(layer, feature, id, label);
        record.domLabelMarkers.set(key, marker);
      }
      const element = marker.getElement();
      element.__civgraphFeature = feature;
      element.querySelector('div').textContent = label;
      element.classList.toggle('map-label--selected', this.selected?.layerId === layerId && String(this.selected.id) === key);
      element.hidden = !record.labelsEnabled;
      marker.setLngLat(lngLat);
      if (!element.isConnected) marker.addTo(this.map);
    }
    for (const [key, marker] of record.domLabelMarkers) {
      if (!nextKeys.has(key)) {
        marker.remove();
        record.domLabelMarkers.delete(key);
      }
    }
  }

  createDomLabelMarker(layer, feature, id, label) {
    const labelStyle = getLabelStyle(layer);
    const element = document.createElement('span');
    element.className = 'map-label map-label--clickable maplibre-dom-label';
    element.dataset.layerId = layer.id;
    element.dataset.featureId = String(id);
    element.__civgraphFeature = feature;
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', `Show details for ${label}`);
    const text = document.createElement('div');
    text.textContent = label;
    text.style.color = labelStyle.color;
    text.style.fontSize = `${buildLabelTextSizeExpression(layer, this.layers.get(layer.id)?.textScale || DEFAULT_TEXT_SCALE)}px`;
    element.appendChild(text);
    const select = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.selectFeature(layer, element.__civgraphFeature || feature);
    };
    element.addEventListener('click', select);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') select(event);
    });
    const hover = () => this.setHover(layer, element.__civgraphFeature || feature);
    element.addEventListener('mouseenter', hover);
    element.addEventListener('mouseover', hover);
    element.addEventListener('pointerenter', hover);
    element.addEventListener('mouseleave', () => this.clearHover());
    element.addEventListener('pointerleave', () => this.clearHover());
    return new maplibregl.Marker({ element, anchor: 'center' });
  }

  clearDomLabels(layerId) {
    const record = this.layers.get(layerId);
    if (!record?.domLabelMarkers) return;
    if (record.domLabelsScheduled) {
      cancelAnimationFrame(record.domLabelsScheduled);
      record.domLabelsScheduled = 0;
    }
    for (const marker of record.domLabelMarkers.values()) marker.remove();
    record.domLabelMarkers.clear();
  }

  setDomLabelHover(layerId, featureId, isHover) {
    const marker = this.layers.get(layerId)?.domLabelMarkers?.get(String(featureId));
    marker?.getElement().classList.toggle('map-label--hover', Boolean(isHover));
  }

  setDomLabelSelected(layerId, featureId, isSelected) {
    const marker = this.layers.get(layerId)?.domLabelMarkers?.get(String(featureId));
    marker?.getElement().classList.toggle('map-label--selected', Boolean(isSelected));
  }

  clearFeatureState(selection, key) {
    if (selection?.layerId) this.clearInteractionOverlay(selection.layerId, key);
    if (!selection?.sourceId || selection.id === undefined || selection.id === null) return;
    if (!this.map.getSource(selection.sourceId)) return;
    if (selection.generated) return;
    try {
      this.map.setFeatureState({ source: selection.sourceId, sourceLayer: selection.sourceLayer, id: selection.id }, { [key]: false });
    } catch {}
  }

  waitForMap() {
    if (this.map.isStyleLoaded?.() || this.map.loaded()) return Promise.resolve();
    return new Promise((resolve) => {
      let timer = 0;
      const done = () => {
        clearTimeout(timer);
        this.map.off('load', done);
        this.map.off('styledata', onStyleData);
        resolve();
      };
      const onStyleData = () => {
        if (this.map.isStyleLoaded?.() || this.map.loaded()) done();
      };
      this.map.once('load', done);
      this.map.on('styledata', onStyleData);
      timer = setTimeout(done, 3000);
    });
  }

  notifyChange() {
    this.options.onChange?.(this);
  }

  recordMetric(metric) {
    this.metrics.push(metric);
    this.options.onMetric?.(metric);
  }

  getMetrics() {
    return [...this.metrics];
  }
}

function isColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function featureLabelLngLat(feature) {
  const props = feature?.properties || {};
  const explicitLon = Number(props.label_lon ?? props.label_lng ?? props.lon ?? props.lng ?? props.longitude);
  const explicitLat = Number(props.label_lat ?? props.lat ?? props.latitude);
  if (Number.isFinite(explicitLon) && Number.isFinite(explicitLat)) return [explicitLon, explicitLat];
  const points = [];
  collectCoordinatePairs(feature?.geometry?.coordinates, points);
  if (!points.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (![minLng, maxLng, minLat, maxLat].every(Number.isFinite)) return null;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

function labelCollisionBox(point, label) {
  const width = Math.min(Math.max(String(label).length * 7.5, 34), 150);
  const height = Math.max(16, Math.ceil(String(label).length / 18) * 15);
  const padding = 4;
  return {
    left: point.x - width / 2 - padding,
    right: point.x + width / 2 + padding,
    top: point.y - height / 2 - padding,
    bottom: point.y + height / 2 + padding
  };
}

function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function collectCoordinatePairs(value, out) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    out.push([value[0], value[1]]);
    return;
  }
  for (const item of value) collectCoordinatePairs(item, out);
}

function generatedFeatureId(layer, feature) {
  const properties = feature?.properties || {};
  const label = getFeatureLabel(layer, properties) || '';
  const geometryKey = geometrySignature(feature?.geometry);
  const propertyKey = stablePropertySignature(properties, layer);
  const key = [label, propertyKey, geometryKey].filter(Boolean).join('|');
  return key ? `generated:${hashString(key)}` : null;
}

function fallbackGeneratedFeatureId(layer, feature, rawId) {
  const properties = feature?.properties || {};
  const label = getFeatureLabel(layer, properties) || '';
  const propertyKey = stablePropertySignature(properties, layer);
  const key = [
    layer?.id || '',
    rawId === undefined || rawId === null ? '' : String(rawId),
    label,
    propertyKey,
    JSON.stringify(properties).slice(0, 500)
  ].filter(Boolean).join('|');
  return key ? `generated:${hashString(key)}` : null;
}

function geometrySignature(geometry) {
  const points = [];
  collectCoordinatePairs(geometry?.coordinates, points);
  if (!points.length) return '';
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return '';
  const first = points[0] || [];
  const middle = points[Math.floor(points.length / 2)] || [];
  const last = points[points.length - 1] || [];
  return [
    geometry?.type || 'Geometry',
    points.length,
    roundCoord(minLng),
    roundCoord(minLat),
    roundCoord(maxLng),
    roundCoord(maxLat),
    roundCoord(first[0]),
    roundCoord(first[1]),
    roundCoord(middle[0]),
    roundCoord(middle[1]),
    roundCoord(last[0]),
    roundCoord(last[1])
  ].join(':');
}

function stablePropertySignature(properties, layer) {
  const keys = [
    layer?.labelProperty,
    ...(layer?.labelPropertyFallbacks || []),
    ...(layer?.popupProperties || []),
    'name',
    'Name',
    'NAME'
  ].filter(Boolean);
  return [...new Set(keys)]
    .slice(0, 8)
    .map((key) => {
      const value = properties?.[key];
      return value === undefined || value === null ? '' : `${key}=${String(value).slice(0, 80)}`;
    })
    .filter(Boolean)
    .join(';');
}

function roundCoord(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : '';
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cloneGeometry(geometry) {
  if (!geometry?.type || !geometry.coordinates) return null;
  return JSON.parse(JSON.stringify({
    type: geometry.type,
    coordinates: geometry.coordinates
  }));
}

function readLayerPreferences(layerId) {
  try {
    return JSON.parse(localStorage.getItem(`civgraph:test:controls:${layerId}`) || 'null');
  } catch {
    return null;
  }
}

function readLayerOrder() {
  try {
    return JSON.parse(localStorage.getItem('civgraph:test:layer-order') || '[]');
  } catch {
    return [];
  }
}

function writeLayerOrder(order) {
  try {
    localStorage.setItem('civgraph:test:layer-order', JSON.stringify(order));
  } catch {}
}
