import {
  Cartesian2, Cartesian3, CallbackProperty, Color, ColorMaterialProperty, ConstantPositionProperty, Entity, HeightReference,
  ImageryLayer, Ion, Matrix4, ModelGraphics, ConstantProperty, JulianDate, LabelStyle, PolygonHierarchy, PolylineDashMaterialProperty, Rectangle, ScreenSpaceEventHandler,
  ScreenSpaceEventType, SingleTileImageryProvider, Terrain, TileMapServiceImageryProvider, VerticalOrigin, Viewer, buildModuleUrl,
  createWorldImageryAsync, defined, Ellipsoid, Quaternion, UrlTemplateImageryProvider, WebMercatorTilingScheme, PolylineGlowMaterialProperty,
} from 'cesium';
import type { GroundStation, Maneuver, Satellite, Vec3 } from '@/types';
import type { SimulationClock } from '../simulation/SimulationClock';
import type { Layers } from '@/stores/store';
import { propagateSatellite, propagateBaseline, propsOf } from '../orbital/propagate';
import { eciToEcef, geodeticToEcef } from '../orbital/frames';
import { lookAngles, visibilityCentralAngle } from '../orbital/lookangles';
import { DEG, R_EARTH } from '../orbital/constants';
import { derivedElements, rvToElements } from '../orbital/elements';
import { gmst } from '../orbital/time';
import { pointFromState, stepForPeriod, type EphemerisPoint } from '../orbital/ephemeris';
import { burnDirection } from '../orbital/maneuvers';
import { attitudeAt, quatRotate, sensorFootprint, targetQuat, type AttitudeContext, type Quat } from '../orbital/attitude';
import { modelKindFor, modelUrl, type ModelKind } from './models/templates';
import { sunPositionEci } from '../orbital/sun';
import { saaOutline } from '../orbital/environment';
import type { SimEvent } from '../events/EventTypes';

/**
 * Visualization only. All positions come from the Orbital Engine (propagateSatellite); Cesium never computes physics.
 * Satellite positions are handed to Cesium in ECEF built with the engine's GMST rotation, so the 3D view, the dashboard and
 * all analyses share one definition of ECI→ECEF. Orbit paths are sampled in ECI and rotated with the current GMST each frame.
 */

interface PathCache { tRef: number; period: number; samples: EphemerisPoint[]; ghost: EphemerisPoint[]; key: string }

interface Sat3D {
  sat: Satellite;
  light: boolean;
  kind?: ModelKind;
  entity: Entity;
  pos: ConstantPositionProperty;
  extras: Entity[];
  nadirPos?: ConstantPositionProperty;
  arrays: { orbitPast: Cartesian3[]; orbitFuture: Cartesian3[]; gtPast: Cartesian3[]; gtFuture: Cartesian3[]; nadir: Cartesian3[]; ghost: Cartesian3[] };
  entities: { orbitPast?: Entity; orbitFuture?: Entity; gtPast?: Entity; gtFuture?: Entity; nadirLine?: Entity; nadirPoint?: Entity; ghost?: Entity };
  cache: PathCache | null;
  links: Map<string, { entity: Entity; arr: Cartesian3[] }>;
}

interface Stn3D { stn: GroundStation; entity: Entity; cone: Entity; ecef: Cartesian3; coneRadius: { v: number } }

export type CameraMode = 'earth' | 'follow' | 'free' | 'orbit' | 'groundstation' | 'relative' | 'dual';
export interface CameraContext { stationId: string | null; secondId: string | null }
export interface SavedView { name: string; position: [number, number, number]; direction: [number, number, number]; up: [number, number, number] }

export interface SceneHooks {
  onSelect: (id: string | null) => void;
  onFrame: (t: number) => void;
  onPick: (lat: number, lon: number) => void;
}

export interface Overlay { lines: string[] }

export class CesiumScene {
  readonly viewer: Viewer;
  private sats = new Map<string, Sat3D>();
  private stns = new Map<string, Stn3D>();
  private raf = 0;
  private selectedId: string | null = null;
  private layers: Layers | null = null;
  private handler: ScreenSpaceEventHandler;
  private disposed = false;
  private hires: ImageryLayer | null = null;
  private lights: ImageryLayer | null = null;
  private camMode: CameraMode = 'earth';
  private camCtx: CameraContext = { stationId: null, secondId: null };
  private pickMode = false;
  private effects: { event: SimEvent; r: Vec3; entity: Entity }[] = [];
  private heatLayer: ImageryLayer | null = null;
  private targetEntity: Entity | null = null;
  private conjEntity: { entity: Entity; arr: Cartesian3[]; ids: [string, string] } | null = null;
  private saa: Entity;
  // selected-satellite decorations
  private fx: { burnVec: Entity; plume: Entity; axes: Entity[]; cone: Entity[]; foot: Entity; footPts: Cartesian3[]; burnArr: Cartesian3[]; plumeArr: Cartesian3[]; axArr: Cartesian3[][]; coneArr: Cartesian3[][] };
  private overlayProvider: (() => Overlay) | null = null;
  private composite: HTMLCanvasElement | null = null;
  private shotResolve: ((b: Blob) => void) | null = null;
  private shotOpts: { overlay: boolean } | null = null;
  private recorder: MediaRecorder | null = null;
  private recordChunks: Blob[] = [];
  private recordOverlay = true;

  constructor(container: HTMLElement, private clock: SimulationClock, private hooks: SceneHooks) {
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
    if (token) Ion.defaultAccessToken = token;

    this.viewer = new Viewer(container, {
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, baseLayer: false,
      requestRenderMode: false, terrain: token ? Terrain.fromWorldTerrain() : undefined,
    });
    const v = this.viewer;
    v.useDefaultRenderLoop = false;
    v.clock.shouldAnimate = false;
    v.clock.currentTime = JulianDate.fromDate(new Date(clock.time));
    const provider = token ? createWorldImageryAsync() : TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'));
    v.imageryLayers.add(ImageryLayer.fromProviderAsync(provider as Promise<never>));
    if (!token) {
      // Free NASA GIBS layers drawn over the offline base (public tiles, no key). If the network blocks them the offline base remains.
      const gibs = (layer: string, ext: string, credit: string) => new ImageryLayer(new UrlTemplateImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.${ext}`,
        tilingScheme: new WebMercatorTilingScheme(), maximumLevel: 8, credit,
      }));
      this.hires = gibs('BlueMarble_ShadedRelief_Bathymetry', 'jpeg', 'NASA GIBS – Blue Marble');
      this.lights = gibs('VIIRS_Black_Marble', 'png', 'NASA GIBS – VIIRS Black Marble');
      this.lights.dayAlpha = 0; this.lights.nightAlpha = 1;
      v.imageryLayers.add(this.hires); v.imageryLayers.add(this.lights);
    }

    const scene = v.scene;
    scene.globe.enableLighting = true;
    scene.globe.showGroundAtmosphere = true;
    scene.globe.baseColor = Color.fromCssColorString('#0a1a2f');
    scene.highDynamicRange = false;
    scene.fog.enabled = false;
    scene.globe.depthTestAgainstTerrain = false;
    scene.globe.maximumScreenSpaceError = 1.5;
    scene.globe.atmosphereLightIntensity = 14;
    scene.postProcessStages.fxaa.enabled = true;
    const bloom = scene.postProcessStages.bloom;
    bloom.enabled = true; bloom.uniforms.brightness = -0.35; bloom.uniforms.contrast = 110; bloom.uniforms.glowOnly = false;
    v.camera.setView({ destination: Cartesian3.fromDegrees(100, 15, 2.2e7) });

    const pts = saaOutline();
    this.saa = v.entities.add({
      name: 'South Atlantic Anomaly (simulated, approximate)',
      polygon: { hierarchy: Cartesian3.fromDegreesArray(pts.flat()), material: Color.fromCssColorString('#f43f5e').withAlpha(0.18), height: 0, outline: true, outlineColor: Color.fromCssColorString('#f43f5e') },
      show: false,
    });

    const line = (c: Color, w: number, get: () => Cartesian3[], dash = false) => v.entities.add({
      polyline: { positions: new CallbackProperty(get, false), width: w, arcType: 0 as never, material: dash ? new PolylineDashMaterialProperty({ color: c }) : new ColorMaterialProperty(c) }, show: false,
    });
    const burnArr: Cartesian3[] = [Cartesian3.ZERO, Cartesian3.ZERO], plumeArr: Cartesian3[] = [Cartesian3.ZERO, Cartesian3.ZERO];
    const axArr = [0, 1, 2].map(() => [Cartesian3.ZERO, Cartesian3.ZERO]);
    const coneArr = [0, 1, 2, 3].map(() => [Cartesian3.ZERO, Cartesian3.ZERO]);
    const footPts: Cartesian3[] = [];
    this.fx = {
      burnArr, plumeArr, axArr, coneArr, footPts,
      burnVec: line(Color.YELLOW, 3, () => burnArr), plume: line(Color.ORANGE, 9, () => plumeArr),
      axes: [Color.RED, Color.LIME, Color.DODGERBLUE].map((c, i) => line(c, 3, () => axArr[i])),
      cone: coneArr.map((a) => line(Color.CYAN.withAlpha(0.6), 1, () => a)),
      foot: v.entities.add({ polygon: { hierarchy: new CallbackProperty(() => new PolygonHierarchy(footPts), false), material: Color.CYAN.withAlpha(0.22), perPositionHeight: false, outline: false }, show: false }),
    };

    this.handler = new ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e: { position: Cartesian2 }) => {
      if (this.pickMode) {
        const ray = v.camera.getPickRay(e.position);
        const p = ray ? scene.globe.pick(ray, scene) : undefined;
        if (p) { const c = Ellipsoid.WGS84.cartesianToCartographic(p); hooks.onPick(c.latitude / DEG, c.longitude / DEG); return; }
      }
      const picked = scene.pick(e.position);
      if (defined(picked) && picked.id instanceof Entity) for (const [id, s] of this.sats) if (s.entity === picked.id) return hooks.onSelect(id);
    }, ScreenSpaceEventType.LEFT_CLICK);

    const loop = () => {
      if (this.disposed) return;
      this.clock.tick(performance.now());
      try { this.frame(); } catch (err) { console.error('frame error', err); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /* ---------------- scene sync ---------------- */

  setSatellites(list: Satellite[]): void {
    const ids = new Set(list.map((s) => s.id));
    for (const [id, s] of this.sats) if (!ids.has(id)) { this.removeSat(s); this.sats.delete(id); }
    for (const sat of list) {
      const have = this.sats.get(sat.id);
      if (!have) this.sats.set(sat.id, this.addSat(sat));
      else if (have.sat !== sat) {
        have.sat = sat; have.cache = null;
        if (have.entity.label) have.entity.label.text = sat.name as never;
      }
    }
    if (this.layers) this.setLayers(this.layers);
  }

  setStations(list: GroundStation[]): void {
    const ids = new Set(list.map((g) => g.id));
    for (const [id, g] of this.stns) if (!ids.has(id)) {
      this.viewer.entities.remove(g.entity); this.viewer.entities.remove(g.cone); this.stns.delete(id);
      for (const s of this.sats.values()) { const l = s.links.get(id); if (l) { this.viewer.entities.remove(l.entity); s.links.delete(id); } }
    }
    for (const g of list) {
      const have = this.stns.get(g.id);
      if (have) { have.stn = g; have.ecef = Cartesian3.fromArray(geodeticToEcef(g)); have.entity.label!.text = g.name as never; }
      else this.stns.set(g.id, this.addStation(g));
    }
    if (this.layers) this.setLayers(this.layers);
  }

  setLayers(l: Layers): void {
    this.layers = l;
    const scene = this.viewer.scene;
    scene.globe.enableLighting = l.lighting;
    scene.globe.showGroundAtmosphere = l.atmosphere;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = l.atmosphere;
    for (const s of this.sats.values()) {
      const show = s.light ? l.debris : l.satellites;
      s.entity.show = show;
      if (s.entity.model) s.entity.model.show = l.models as never;
      if (s.entity.label) s.entity.label.show = l.labels as never;
      const e = s.entities;
      if (e.orbitPast) e.orbitPast.show = e.orbitFuture!.show = l.orbits;
      if (e.gtPast) e.gtPast.show = e.gtFuture!.show = l.groundTracks;
      if (e.nadirLine) e.nadirLine.show = e.nadirPoint!.show = l.nadirLine;
      if (e.ghost) e.ghost.show = l.orbits;
    }
    for (const g of this.stns.values()) { g.entity.show = l.stations; g.cone.show = l.stations && l.visibilityCones; }
    this.saa.show = l.saa;
    if (this.hires) this.hires.show = l.hiresImagery;
    if (this.lights) this.lights.show = l.cityLights;
    if (this.heatLayer) this.heatLayer.show = l.coverage;
    for (const x of this.effects) x.entity.show = l.eventEffects;
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const [sid, s] of this.sats) if (s.entity.point && !s.light) s.entity.point.pixelSize = (sid === id ? 12 : 8) as never;
  }

  setPickMode(b: boolean): void { this.pickMode = b; this.viewer.scene.canvas.style.cursor = b ? 'crosshair' : ''; }

  setOverlayProvider(p: (() => Overlay) | null): void { this.overlayProvider = p; }

  setTarget(t: { lat: number; lon: number } | null): void {
    if (this.targetEntity) { this.viewer.entities.remove(this.targetEntity); this.targetEntity = null; }
    if (!t) return;
    this.targetEntity = this.viewer.entities.add({
      position: Cartesian3.fromDegrees(t.lon, t.lat, 0),
      point: { pixelSize: 11, color: Color.MAGENTA, outlineColor: Color.WHITE, outlineWidth: 2, heightReference: HeightReference.NONE, disableDepthTestDistance: 1e7 },
      label: { text: 'TARGET', font: '12px monospace', fillColor: Color.MAGENTA, pixelOffset: new Cartesian2(0, -16), style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK, disableDepthTestDistance: 1e7 },
    });
  }

  setConjunction(ids: [string, string] | null): void {
    if (this.conjEntity) { this.viewer.entities.remove(this.conjEntity.entity); this.conjEntity = null; }
    if (!ids) return;
    const arr = [Cartesian3.ZERO, Cartesian3.ZERO];
    const entity = this.viewer.entities.add({ polyline: { positions: new CallbackProperty(() => arr, false), width: 2, arcType: 0 as never, material: new PolylineDashMaterialProperty({ color: Color.RED }) } });
    this.conjEntity = { entity, arr, ids };
  }

  /** Coverage heatmap: an equirectangular canvas draped over the globe as an imagery layer. */
  setHeatmap(canvas: HTMLCanvasElement | null, rect?: { west: number; south: number; east: number; north: number }): void {
    if (this.heatLayer) { this.viewer.imageryLayers.remove(this.heatLayer, true); this.heatLayer = null; }
    if (!canvas || !rect) return;
    const url = canvas.toDataURL('image/png');
    const layer = ImageryLayer.fromProviderAsync(SingleTileImageryProvider.fromUrl(url, { rectangle: Rectangle.fromDegrees(rect.west, rect.south, rect.east, rect.north) }));
    layer.alpha = 0.65;
    this.viewer.imageryLayers.add(layer);
    this.heatLayer = layer;
  }

  /** Event visual effects (collision flash, deployment marker) at the inertial location of the event. */
  setEvents(events: SimEvent[], sats: Satellite[]): void {
    for (const x of this.effects) this.viewer.entities.remove(x.entity);
    this.effects = [];
    for (const e of events) {
      if (!e.enabled) continue;
      let r: Vec3 | null = null, text = e.name, color = Color.fromCssColorString(e.visual.color ?? '#ffffff');
      if (e.type === 'collision') { const d = sats.find((s) => s.id === `${e.id}-deb-0`); if (d?.source.kind === 'state') r = d.source.r; text = 'COLLISION'; color = Color.RED; }
      else if (e.type === 'deployment') { const d = sats.find((s) => s.id === `${e.id}-obj`); if (d?.source.kind === 'state') r = d.source.r; text = `DEPLOY ${e.params.name ?? ''}`; }
      if (!r) continue;
      const entity = this.viewer.entities.add({
        position: new ConstantPositionProperty(Cartesian3.ZERO),
        point: { pixelSize: 14, color: color.withAlpha(0.8), outlineColor: Color.WHITE, outlineWidth: 1, disableDepthTestDistance: 1e9 },
        label: { text, font: '12px monospace', fillColor: color, pixelOffset: new Cartesian2(0, -18), style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK, disableDepthTestDistance: 1e9 },
        show: false,
      });
      this.effects.push({ event: e, r, entity });
    }
  }

  /* ---------------- camera ---------------- */

  setCameraMode(mode: CameraMode, ctx: CameraContext): void {
    const v = this.viewer;
    this.camMode = mode; this.camCtx = ctx;
    v.trackedEntity = undefined;
    v.camera.lookAtTransform(Matrix4.IDENTITY);
    if (mode === 'follow' && this.selectedId && this.sats.has(this.selectedId)) v.trackedEntity = this.sats.get(this.selectedId)!.entity;
    else if (mode === 'earth') v.camera.flyTo({ destination: Cartesian3.fromDegrees(100, 15, 2.2e7), duration: 1.2 });
  }

  saveView(name: string): SavedView {
    const c = this.viewer.camera;
    return { name, position: [c.position.x, c.position.y, c.position.z], direction: [c.direction.x, c.direction.y, c.direction.z], up: [c.up.x, c.up.y, c.up.z] };
  }
  applyView(sv: SavedView): void {
    this.camMode = 'free'; this.viewer.trackedEntity = undefined;
    this.viewer.camera.setView({ destination: new Cartesian3(...sv.position), orientation: { direction: new Cartesian3(...sv.direction), up: new Cartesian3(...sv.up) } });
  }

  private lookFrom(pos: Cartesian3, target: Cartesian3, upHint: Cartesian3): void {
    const dir = Cartesian3.normalize(Cartesian3.subtract(target, pos, new Cartesian3()), new Cartesian3());
    const k = Cartesian3.dot(upHint, dir);
    const up = Cartesian3.normalize(Cartesian3.subtract(upHint, Cartesian3.multiplyByScalar(dir, k, new Cartesian3()), new Cartesian3()), new Cartesian3());
    this.viewer.camera.setView({ destination: pos, orientation: { direction: dir, up } });
  }

  private cameraFrame(t: number): void {
    const m = this.camMode;
    if (m !== 'groundstation' && m !== 'orbit' && m !== 'relative' && m !== 'dual') return;
    const sel = this.selectedId ? this.sats.get(this.selectedId) : undefined;
    const st = sel ? propagateSatellite(sel.sat, t) : null;
    if (!sel || !st) return;
    const rE = eciToEcef(st.r, t), P = new Cartesian3(rE[0], rE[1], rE[2]);
    if (m === 'groundstation') {
      const g = this.camCtx.stationId ? this.stns.get(this.camCtx.stationId) : [...this.stns.values()][0];
      if (!g) return;
      const up = Ellipsoid.WGS84.geodeticSurfaceNormal(g.ecef, new Cartesian3());
      const pos = Cartesian3.add(g.ecef, Cartesian3.multiplyByScalar(up, 5, new Cartesian3()), new Cartesian3());
      this.lookFrom(pos, P, up);
    } else if (m === 'orbit') {
      const h: Vec3 = [st.r[1] * st.v[2] - st.r[2] * st.v[1], st.r[2] * st.v[0] - st.r[0] * st.v[2], st.r[0] * st.v[1] - st.r[1] * st.v[0]];
      const hn = Math.hypot(...h), hE = eciToEcef([h[0] / hn, h[1] / hn, h[2] / hn], t);
      const d = 3.2 * Math.hypot(...st.r);
      this.lookFrom(new Cartesian3(hE[0] * d, hE[1] * d, hE[2] * d), Cartesian3.ZERO, P);
    } else {
      const other = this.camCtx.secondId ? this.sats.get(this.camCtx.secondId) : [...this.sats.values()].find((s) => s !== sel && !s.light);
      const so = other ? propagateSatellite(other.sat, t) : null;
      if (!so) return;
      const oE = eciToEcef(so.r, t), O = new Cartesian3(oE[0], oE[1], oE[2]);
      if (m === 'dual') {
        const mid = Cartesian3.midpoint(P, O, new Cartesian3());
        const sep = Cartesian3.distance(P, O), out = Cartesian3.normalize(mid, new Cartesian3());
        const pos = Cartesian3.add(mid, Cartesian3.multiplyByScalar(out, Math.max(sep * 1.6, 1.5e6), new Cartesian3()), new Cartesian3());
        this.lookFrom(pos, mid, Cartesian3.UNIT_Z);
      } else {
        const vE = eciToEcef(st.v, t), vh = Cartesian3.normalize(new Cartesian3(vE[0], vE[1], vE[2]), new Cartesian3());
        const out = Cartesian3.normalize(P, new Cartesian3());
        const pos = Cartesian3.add(Cartesian3.add(P, Cartesian3.multiplyByScalar(vh, -30_000, new Cartesian3()), new Cartesian3()), Cartesian3.multiplyByScalar(out, 8_000, new Cartesian3()), new Cartesian3());
        this.lookFrom(pos, O, out);
      }
    }
  }

  /* ---------------- entities ---------------- */

  private addStation(g: GroundStation): Stn3D {
    const color = Color.fromCssColorString(g.color);
    const ecef = Cartesian3.fromArray(geodeticToEcef(g));
    const coneRadius = { v: 1_500_000 };
    const entity = this.viewer.entities.add({
      name: g.name, position: Cartesian3.fromRadians(g.lon, g.lat, g.alt),
      point: { pixelSize: 9, color, outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: 1e7 },
      label: { text: g.name, font: '12px ui-monospace, monospace', fillColor: color, style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK, pixelOffset: new Cartesian2(0, 16), disableDepthTestDistance: 1e7 },
    });
    const cone = this.viewer.entities.add({
      position: Cartesian3.fromRadians(g.lon, g.lat, 0),
      ellipse: { semiMajorAxis: new CallbackProperty(() => coneRadius.v, false), semiMinorAxis: new CallbackProperty(() => coneRadius.v, false), material: color.withAlpha(0.12), outline: false, height: 0 },
    });
    return { stn: g, entity, cone, ecef, coneRadius };
  }

  private addSat(sat: Satellite): Sat3D {
    const v = this.viewer;
    const color = Color.fromCssColorString(sat.color);
    const pos = new ConstantPositionProperty(Cartesian3.ZERO);
    const light = sat.kind === 'debris';
    const arrays = { orbitPast: [] as Cartesian3[], orbitFuture: [] as Cartesian3[], gtPast: [] as Cartesian3[], gtFuture: [] as Cartesian3[], nadir: [Cartesian3.ZERO, Cartesian3.ZERO], ghost: [] as Cartesian3[] };
    const entity = v.entities.add({
      name: sat.name, position: pos,
      point: { pixelSize: light ? 3 : 5, color, outlineColor: light ? color : Color.WHITE, outlineWidth: light ? 0 : 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: light ? undefined : { text: sat.name, font: '12px ui-monospace, monospace', fillColor: Color.WHITE, style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK, showBackground: true, backgroundColor: Color.fromCssColorString('#050a14').withAlpha(0.6), verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -38), disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
    let kind: ModelKind | undefined;
    if (!light) {
      kind = modelKindFor(sat);
      const m = modelUrl(kind);
      // true-size model that never shrinks below ~64 px, so it is visible from orbit-scale distances and detailed when zoomed in
      entity.model = new ModelGraphics({ uri: m.url, minimumPixelSize: 64, maximumScale: 20000, scale: 1, runAnimations: false });
      entity.orientation = new ConstantProperty(Quaternion.IDENTITY);
      entity.viewFrom = new ConstantProperty(new Cartesian3(0, -m.radius * 5, m.radius * 2.5));
    }
    const s3: Sat3D = { sat, light, kind, entity, pos, extras: [], arrays, entities: {}, cache: null, links: new Map() };
    if (light) return s3;
    const line = (name: string, get: () => Cartesian3[], c: Color, width: number, dashed = false, glow = false) =>
      v.entities.add({ name, polyline: { positions: new CallbackProperty(get, false), width: glow ? width * 3 : width, arcType: 0 as never, material: glow ? new PolylineGlowMaterialProperty({ glowPower: 0.22, color: c }) : dashed ? new PolylineDashMaterialProperty({ color: c, dashLength: 12 }) : new ColorMaterialProperty(c) } });
    s3.nadirPos = new ConstantPositionProperty(Cartesian3.ZERO);
    s3.entities = {
      nadirPoint: v.entities.add({ position: s3.nadirPos, point: { pixelSize: 5, color: color.withAlpha(0.9) } }),
      nadirLine: line(`${sat.name} nadir`, () => arrays.nadir, color.withAlpha(0.35), 1),
      orbitPast: line(`${sat.name} past orbit`, () => arrays.orbitPast, color.withAlpha(0.35), 1.5),
      orbitFuture: line(`${sat.name} future orbit`, () => arrays.orbitFuture, color.withAlpha(0.95), 2, false, true),
      gtPast: line(`${sat.name} past ground track`, () => arrays.gtPast, Color.WHITE.withAlpha(0.35), 1.5),
      gtFuture: line(`${sat.name} future ground track`, () => arrays.gtFuture, Color.YELLOW.withAlpha(0.9), 2, true),
      ghost: line(`${sat.name} orbit without maneuver`, () => arrays.ghost, Color.WHITE.withAlpha(0.55), 1.5, true),
    };
    return s3;
  }

  private removeSat(s: Sat3D): void {
    const v = this.viewer;
    [s.entity, ...Object.values(s.entities), ...[...s.links.values()].map((l) => l.entity)].forEach((e) => e && v.entities.remove(e));
  }

  /* ---------------- per frame ---------------- */

  private frame(): void {
    const t = this.clock.time;
    const v = this.viewer;
    v.clock.currentTime = JulianDate.fromDate(new Date(t));
    const th = gmst(t), c = Math.cos(th), sn = Math.sin(th);
    const states = new Map<string, { rE: Vec3; cart: Cartesian3 }>();
    const sunEci = sunPositionEci(t);
    const hz = th / 2, qz: Quat = [Math.cos(hz), 0, 0, -Math.sin(hz)]; // ECI→ECEF rotation (−θ about z)

    for (const s3 of this.sats.values()) {
      const st = propagateSatellite(s3.sat, t);
      if (!st) { s3.entity.show = false; for (const e of Object.values(s3.entities)) if (e) e.show = false; continue; }
      const rE = eciToEcef(st.r, t);
      const cart = new Cartesian3(rE[0], rE[1], rE[2]);
      s3.pos.setValue(cart);
      states.set(s3.sat.id, { rE, cart });
      if (s3.light) { s3.entity.show = this.layers?.debris ?? true; continue; }
      const qb = s3.sat.attitude?.length
        ? attitudeAt(s3.sat.attitude, t, (tt): AttitudeContext | null => { const x = propagateSatellite(s3.sat, tt); return x ? { r: x.r, v: x.v, sunEci: sunPositionEci(tt), utcMs: tt } : null; })
        : targetQuat({ mode: 'nadir' }, { r: st.r, v: st.v, sunEci, utcMs: t });
      if (qb) { const q = quatMul(qz, qb); (s3.entity.orientation as ConstantProperty).setValue(new Quaternion(q[1], q[2], q[3], q[0])); }
      const L = this.layers;
      s3.entity.show = L?.satellites ?? true;
      for (const [k, e] of Object.entries(s3.entities)) if (e) e.show = k === 'ghost' ? (L?.orbits ?? true) && !!s3.sat.maneuvers?.length : k.startsWith('gt') ? L?.groundTracks ?? true : k.startsWith('nadir') ? L?.nadirLine ?? true : L?.orbits ?? true;
      const pt = pointFromState(st);
      const surf = Cartesian3.fromRadians(pt.geo.lon, pt.geo.lat, 0);
      s3.nadirPos!.setValue(surf);
      s3.arrays.nadir = [cart, surf];
      this.refreshPaths(s3, t, c, sn);
      this.updateLinks(s3, cart, rE);
      if (s3.sat.id === this.selectedId) {
        const R = Math.hypot(...rE);
        for (const g of this.stns.values()) g.coneRadius.v = R_EARTH * visibilityCentralAngle(R_EARTH, R, g.stn.minElevation);
      }
    }
    this.updateSelectedFx(t, states);
    if (this.conjEntity) {
      const a = states.get(this.conjEntity.ids[0]), b = states.get(this.conjEntity.ids[1]);
      this.conjEntity.entity.show = !!a && !!b && (this.layers?.conjunction ?? true);
      if (a && b) this.conjEntity.arr = [a.cart, b.cart];
    }
    for (const x of this.effects) {
      const dt = (t - x.event.start) / 1000;
      const vis = (this.layers?.eventEffects ?? true) && dt >= 0 && dt < 600;
      x.entity.show = vis;
      if (vis) { const e = eciToEcef(x.r, t); (x.entity.position as ConstantPositionProperty).setValue(new Cartesian3(e[0], e[1], e[2])); }
    }
    this.cameraFrame(t);
    this.hooks.onFrame(t);
    v.render();
    this.afterRender(t);
  }

  private updateLinks(s3: Sat3D, cart: Cartesian3, rE: Vec3): void {
    for (const g of this.stns.values()) {
      let l = s3.links.get(g.stn.id);
      if (!l) {
        const arr = [Cartesian3.ZERO, Cartesian3.ZERO];
        const entity = this.viewer.entities.add({ polyline: { positions: new CallbackProperty(() => arr, false), width: 1.5, arcType: 0 as never, material: Color.fromCssColorString('#22c55e').withAlpha(0.9) } });
        l = { entity, arr }; s3.links.set(g.stn.id, l);
      }
      const la = lookAngles(g.stn, rE);
      const visible = la.el >= g.stn.minElevation && (this.layers?.commLinks ?? true) && (this.layers?.stations ?? true);
      l.entity.show = visible;
      if (visible) { l.arr[0] = g.ecef; l.arr[1] = cart; }
    }
  }

  /** Burn vector + plume, body axes, sensor cone and footprint for the selected satellite. */
  private updateSelectedFx(t: number, states: Map<string, { rE: Vec3; cart: Cartesian3 }>): void {
    const fx = this.fx, s3 = this.selectedId ? this.sats.get(this.selectedId) : undefined;
    const cur = s3 ? states.get(s3.sat.id) : undefined;
    const hide = () => { fx.burnVec.show = fx.plume.show = fx.foot.show = false; fx.axes.forEach((a) => (a.show = false)); fx.cone.forEach((a) => (a.show = false)); };
    if (!s3 || !cur || s3.light) return hide();
    const st = propagateSatellite(s3.sat, t);
    if (!st) return hide();
    const rot = (x: Vec3): Vec3 => eciToEcef(x, t);
    const P = cur.cart;
    const add = (d: Vec3, len: number) => new Cartesian3(P.x + d[0] * len, P.y + d[1] * len, P.z + d[2] * len);
    // burn
    const burn = activeBurn(s3.sat.maneuvers, t);
    const L = this.layers;
    fx.burnVec.show = fx.plume.show = !!burn && (L?.eventEffects ?? true);
    if (burn) {
      const d = rot(burnDirection(burn.direction, st.r, st.v));
      fx.burnArr[0] = P; fx.burnArr[1] = add(d, 600_000);
      fx.plumeArr[0] = P; fx.plumeArr[1] = add(d, -250_000);
    }
    // attitude axes & sensor
    const q = attitudeAt(s3.sat.attitude, t, (tt): AttitudeContext | null => { const s = propagateSatellite(s3.sat, tt); return s ? { r: s.r, v: s.v, sunEci: sunPositionEci(tt), utcMs: tt } : null; });
    const showAx = !!q && (L?.bodyAxes ?? true);
    fx.axes.forEach((a) => (a.show = showAx));
    if (q && showAx) ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).forEach((ax, i) => { fx.axArr[i][0] = P; fx.axArr[i][1] = add(rot(quatRotate(q, ax)), 700_000); });
    const alpha = propsOf(s3.sat).sensorHalfAngle;
    const showSensor = !!q && !!alpha && (L?.footprints ?? true);
    fx.foot.show = showSensor; fx.cone.forEach((a) => (a.show = showSensor));
    if (q && alpha && showSensor) {
      const bore = rot(quatRotate(q, [0, 0, 1]));
      const ring = sensorFootprint(cur.rE, bore, alpha, 48);
      const pts = ring.filter((p): p is Vec3 => !!p).map((p) => new Cartesian3(p[0], p[1], p[2]));
      fx.footPts.length = 0; pts.forEach((p) => fx.footPts.push(p));
      if (pts.length < 3) fx.foot.show = false;
      [0, 12, 24, 36].forEach((k, i) => { const p = ring[k]; fx.coneArr[i][0] = P; fx.coneArr[i][1] = p ? new Cartesian3(p[0], p[1], p[2]) : add(bore, 2_000_000); });
    }
  }

  private refreshPaths(s3: Sat3D, t: number, c: number, sn: number): void {
    let cache = s3.cache;
    const key = JSON.stringify([s3.sat.source, s3.sat.maneuvers, s3.sat.dynamics, s3.sat.endTime]);
    if (!cache || cache.key !== key || Math.abs(t - cache.tRef) > cache.period * 1000 * 0.08) {
      const st = propagateSatellite(s3.sat, t);
      if (!st) return;
      const period = derivedElements(rvToElements(st.r, st.v)).period;
      if (!isFinite(period) || period <= 0 || period > 86400 * 3) return;
      const step = stepForPeriod(period);
      const t0 = t - period * 1000 * 0.7, t1 = t + period * 1000 * 1.2;
      const n = Math.ceil((t1 - t0) / (step * 1000));
      const samples: EphemerisPoint[] = [], ghost: EphemerisPoint[] = [];
      const hasMan = !!s3.sat.maneuvers?.length;
      for (let k = 0; k <= n; k++) {
        const tk = t0 + ((t1 - t0) * k) / n;
        const sk = propagateSatellite(s3.sat, tk);
        if (sk) samples.push(pointFromState(sk));
        if (hasMan) { const g = propagateBaseline(s3.sat, tk); if (g) ghost.push(pointFromState(g)); }
      }
      cache = s3.cache = { tRef: t, period, samples, ghost, key };
    }
    const P = cache.period * 1000;
    const past: Cartesian3[] = [], fut: Cartesian3[] = [], gtp: Cartesian3[] = [], gtf: Cartesian3[] = [];
    for (const p of cache.samples) {
      const dt = p.t - t;
      if (dt < -P * 0.5 || dt > P) continue;
      const r = p.rEci;
      const cart = new Cartesian3(c * r[0] + sn * r[1], -sn * r[0] + c * r[1], r[2]);
      const gt = Cartesian3.fromRadians(p.geo.lon, p.geo.lat, 2000);
      if (dt <= 0) { past.push(cart); gtp.push(gt); } else { fut.push(cart); gtf.push(gt); }
    }
    const now = s3.arrays.nadir[0], nowSurf = s3.arrays.nadir[1];
    past.push(now); fut.unshift(now); gtp.push(nowSurf); gtf.unshift(nowSurf);
    s3.arrays.orbitPast = past; s3.arrays.orbitFuture = fut; s3.arrays.gtPast = gtp; s3.arrays.gtFuture = gtf;
    s3.arrays.ghost = cache.ghost.filter((p) => p.t >= t - P * 0.5 && p.t <= t + P).map((p) => new Cartesian3(c * p.rEci[0] + sn * p.rEci[1], -sn * p.rEci[0] + c * p.rEci[1], p.rEci[2]));
  }

  /* ---------------- capture ---------------- */

  private afterRender(t: number): void {
    const needShot = this.shotResolve !== null, rec = this.recorder?.state === 'recording';
    if (!needShot && !rec) return;
    const src = this.viewer.scene.canvas;
    if (!this.composite) this.composite = document.createElement('canvas');
    const cv = this.composite;
    if (cv.width !== src.width || cv.height !== src.height) { cv.width = src.width; cv.height = src.height; }
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const withOverlay = needShot ? this.shotOpts!.overlay : this.recordOverlay;
    if (withOverlay) {
      const lines = this.overlayProvider ? this.overlayProvider().lines : [new Date(t).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'];
      const fs = Math.max(14, Math.round(cv.height / 45));
      ctx.font = `600 ${fs}px ui-monospace, monospace`; ctx.textBaseline = 'top';
      lines.forEach((ln, i) => { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(12, 12 + i * (fs + 8), ctx.measureText(ln).width + 16, fs + 8); ctx.fillStyle = '#e2e8f0'; ctx.fillText(ln, 20, 16 + i * (fs + 8)); });
    }
    if (needShot) {
      const res = this.shotResolve!; this.shotResolve = null;
      cv.toBlob((b) => b && res(b), 'image/png');
    }
  }

  /** PNG screenshot of the current view; `scale` > 1 renders at higher resolution (resolutionScale). */
  screenshot(scale: number, overlay: boolean): Promise<Blob> {
    const v = this.viewer, old = v.resolutionScale;
    v.resolutionScale = scale;
    return new Promise((resolve) => {
      this.shotOpts = { overlay };
      this.shotResolve = (b) => { v.resolutionScale = old; resolve(b); };
    });
  }

  startRecording(overlay: boolean, preferMp4: boolean): { mime: string } {
    this.afterRenderInit();
    this.recordOverlay = overlay;
    const cands = preferMp4 ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'] : ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
    const mime = cands.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error('MediaRecorder is not supported by this browser');
    const stream = this.composite!.captureStream(30);
    this.recordChunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.recordChunks.push(e.data);
    this.recorder.start(250);
    return { mime: mime.split(';')[0] };
  }
  private afterRenderInit(): void {
    if (!this.composite) this.composite = document.createElement('canvas');
    const src = this.viewer.scene.canvas; this.composite.width = src.width; this.composite.height = src.height;
  }
  stopRecording(): Promise<Blob> {
    return new Promise((resolve) => {
      const r = this.recorder;
      if (!r) return resolve(new Blob());
      r.onstop = () => resolve(new Blob(this.recordChunks, { type: r.mimeType }));
      r.stop(); this.recorder = null;
    });
  }
  get isRecording(): boolean { return this.recorder?.state === 'recording'; }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.handler.destroy();
    this.viewer.destroy();
  }
}

/** Hamilton product a⊗b of [w,x,y,z] quaternions. */
function quatMul(a: Quat, b: Quat): Quat {
  return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}

/** Burn active at time t: finite burns while running; impulsive ones flash for 60 s after ignition. */
export function activeBurn(ms: Maneuver[] | undefined, t: number): Maneuver | null {
  for (const m of ms ?? []) {
    if (m.kind === 'finite' && t >= m.start && t < m.start + (m.duration ?? 0) * 1000) return m;
    if (m.kind === 'impulsive' && t >= m.start && t < m.start + 60_000) return m;
  }
  return null;
}

