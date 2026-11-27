import {
  Cartesian2, Cartesian3, CallbackProperty, Color, ColorMaterialProperty, ConstantPositionProperty, Entity, HeightReference,
  ImageryLayer, Ion, Matrix4, type TerrainProvider, ModelGraphics, ConstantProperty, JulianDate, LabelStyle, PolygonHierarchy, PolylineDashMaterialProperty, Rectangle, ScreenSpaceEventHandler,
  ScreenSpaceEventType, SingleTileImageryProvider, TileMapServiceImageryProvider, VerticalOrigin, Viewer, buildModuleUrl,
  createWorldImageryAsync, createWorldTerrainAsync, PolylineCollection, Material, EllipsoidTerrainProvider, ArcGisMapServerImageryProvider, Math as CesiumMath, defined, Ellipsoid, Quaternion, UrlTemplateImageryProvider, WebMercatorTilingScheme, PolylineGlowMaterialProperty,
} from 'cesium';
import type { GroundStation, Maneuver, Satellite, Vec3 } from '@/types';
import type { SimulationClock } from '../simulation/SimulationClock';
import type { Layers } from '@/stores/store';
import { propagateSatellite, propagateBaseline, propsOf } from '../orbital/propagate';
import { ecefToGeodetic, eciToEcef, geodeticToEcef } from '../orbital/frames';
import { lookAngles, visibilityCentralAngle } from '../orbital/lookangles';
import { DEG, R_EARTH } from '../orbital/constants';
import { derivedElements, rvToElements } from '../orbital/elements';
import { gmst } from '../orbital/time';
import { pointFromState, stepForPeriod, type EphemerisPoint } from '../orbital/ephemeris';
import { burnDirection } from '../orbital/maneuvers';
import { attitudeAt, quatRotate, sensorFootprint, targetQuat, type AttitudeContext, type Quat } from '../orbital/attitude';
import { modelKindFor, modelUrl, type ModelKind, type ModelStyle } from './models/templates';
import { sunPositionEci } from '../orbital/sun';
import { saaOutline } from '../orbital/environment';
import type { SimEvent } from '../events/EventTypes';
import { createTerrariumProvider } from './terrain';
import { cloudCanvas } from './clouds';
import { DEFAULT_STYLE, type EarthLook, type StyleSettings } from './style';
import { graticuleLines, loadBackground, schematicTexture } from './baseMap';
import { loadBorders } from './borders';

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
  /** reused objects — no per-frame Cartesian3 allocation for the position / nadir point */
  cart: Cartesian3;
  surf: Cartesian3;
  foot?: Entity;
  footPts: Cartesian3[];
  pools: { past: Cartesian3[]; fut: Cartesian3[]; gtp: Cartesian3[]; gtf: Cartesian3[]; ghost: Cartesian3[] };
  links: Map<string, { entity: Entity; arr: Cartesian3[] }>;
}

interface Stn3D { stn: GroundStation; entity: Entity; cone: Entity; ecef: Cartesian3; coneRadius: { v: number } }

export type CameraMode = 'earth' | 'leo' | 'follow' | 'closeup' | 'free' | 'orbit' | 'groundstation' | 'relative' | 'dual' | 'coverage' | 'thailand';
/** Default viewpoint: Thailand (Bangkok). */
const THAI = { lon: 100.5, lat: 13.75, overview: 1.9e7, close: 1.8e6 };
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
  private hidden = new Set<string>();
  private baseLayer: ImageryLayer | null = null;
  private schLayer: ImageryLayer | null = null;
  private graticule: Entity[] = [];
  private borders: PolylineCollection | null = null;
  private bordersLoading = false;
  private hires: ImageryLayer | null = null;
  private lights: ImageryLayer | null = null;
  private cloudLayer: ImageryLayer | null = null;
  private terrain: TerrainProvider | null = null;
  private flat = new EllipsoidTerrainProvider();
  private style: StyleSettings = { ...DEFAULT_STYLE };
  private look: EarthLook = 'standard';
  private shadow: Entity;
  private shadowState = { pos: new Cartesian3(), q: new Quaternion() };
  private camBlendStart = 0;
  private camMode: CameraMode = 'earth';
  private camCtx: CameraContext = { stationId: null, secondId: null };
  private pickMode = false;
  private effects: { event: SimEvent; r: Vec3; entity: Entity }[] = [];
  private heatLayer: ImageryLayer | null = null;
  private targetEntity: Entity | null = null;
  private conjEntity: { entity: Entity; arr: Cartesian3[]; ids: [string, string] } | null = null;
  private saa: Entity;
  // selected-satellite decorations
  private fx: { sunVec: Entity; sunArr: Cartesian3[]; axLabels: Entity[]; velVec: Entity; velArr: Cartesian3[]; burnVec: Entity; plume: Entity; axes: Entity[]; cone: Entity[]; foot: Entity; footPts: Cartesian3[]; burnArr: Cartesian3[]; plumeArr: Cartesian3[]; axArr: Cartesian3[][]; coneArr: Cartesian3[][] };
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
      requestRenderMode: false,
    });
    const v = this.viewer;
    v.useDefaultRenderLoop = false;
    v.clock.shouldAnimate = false;
    v.clock.currentTime = JulianDate.fromDate(new Date(clock.time));
    const provider = token ? createWorldImageryAsync() : TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'));
    this.baseLayer = ImageryLayer.fromProviderAsync(provider as Promise<never>);
    v.imageryLayers.add(this.baseLayer);
    // 'schematic' look: technical blue globe derived from the bundled raster (offline), generated once
    loadBackground().then((bg) => {
      if (this.disposed) return;
      this.schLayer = ImageryLayer.fromProviderAsync(SingleTileImageryProvider.fromUrl(schematicTexture(bg).toDataURL('image/png'), { rectangle: Rectangle.MAX_VALUE }));
      v.imageryLayers.add(this.schLayer);
      if (this.layers) this.setLayers(this.layers);
    });
    if (!token) {
      // Sharp satellite imagery without any key: Esri World Imagery (zoom to street level) over the offline base, plus NASA GIBS city
      // lights on the night side. If the network blocks them, the offline NaturalEarthII base remains visible.
      this.hires = ImageryLayer.fromProviderAsync(ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer', { enablePickFeatures: false }));
      this.lights = new ImageryLayer(new UrlTemplateImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
        tilingScheme: new WebMercatorTilingScheme(), maximumLevel: 8, credit: 'NASA GIBS – VIIRS Black Marble',
      }));
      this.lights.dayAlpha = 0; this.lights.nightAlpha = 1;
      v.imageryLayers.add(this.hires); v.imageryLayers.add(this.lights);
    }

    const scene = v.scene;
    // Terrain: Cesium World Terrain with an Ion token, otherwise keyless Terrarium (AWS) heightmaps; flat ellipsoid when switched off / unreachable.
    if (token) createWorldTerrainAsync().then((tp) => { this.terrain = tp; this.applyTerrain(); }).catch(() => { this.terrain = createTerrariumProvider(); this.applyTerrain(); });
    else { this.terrain = createTerrariumProvider(); this.applyTerrain(); }
    // Procedural cloud layer (offline; generated once, lazily so the first frame is not delayed)
    setTimeout(() => {
      if (this.disposed) return;
      const url = cloudCanvas(1024, 512).toDataURL('image/png');
      this.cloudLayer = ImageryLayer.fromProviderAsync(SingleTileImageryProvider.fromUrl(url, { rectangle: Rectangle.MAX_VALUE }));
      this.cloudLayer.alpha = this.style.cloudOpacity; this.cloudLayer.nightAlpha = 0.25;
      v.imageryLayers.add(this.cloudLayer);
      if (this.layers) this.setLayers(this.layers);
    }, 50);
    scene.globe.enableLighting = true;
    scene.globe.showGroundAtmosphere = true;
    scene.globe.baseColor = Color.fromCssColorString('#0a1a2f');
    scene.highDynamicRange = false;
    scene.fog.enabled = false;
    // smoothness: cap the render resolution on hi-DPI screens, gentle camera inertia, FXAA instead of heavy post-processing
    v.useBrowserRecommendedResolution = false;
    v.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5);
    const cc = scene.screenSpaceCameraController;
    cc.inertiaSpin = 0.94; cc.inertiaTranslate = 0.94; cc.inertiaZoom = 0.88; cc.minimumZoomDistance = 2;
    scene.globe.depthTestAgainstTerrain = false;
    scene.postProcessStages.fxaa.enabled = true;
    // home view: straight down over Thailand, north up (Thailand + neighbours with borders)
    v.camera.setView({ destination: Cartesian3.fromDegrees(THAI.lon, THAI.lat, THAI.close), orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 } });

    const pts = saaOutline();
    this.saa = v.entities.add({
      name: 'South Atlantic Anomaly (simulated, approximate)',
      polygon: { hierarchy: Cartesian3.fromDegreesArray(pts.flat()), material: Color.fromCssColorString('#f43f5e').withAlpha(0.18), height: 0, outline: true, outlineColor: Color.fromCssColorString('#f43f5e') },
      show: false,
    });

    this.graticule = graticuleLines(15, 3).map((l) => v.entities.add({
      polyline: { positions: Cartesian3.fromDegreesArrayHeights(l.flatMap((p) => [p.lon, p.lat, 2500])), width: 1, arcType: 0 as never, material: Color.WHITE.withAlpha(0.5) }, show: false,
    }));
    const line = (c: Color, w: number, get: () => Cartesian3[], dash = false) => v.entities.add({
      polyline: { positions: new CallbackProperty(get, false), width: w, arcType: 0 as never, material: dash ? new PolylineDashMaterialProperty({ color: c }) : new ColorMaterialProperty(c) }, show: false,
    });
    const burnArr: Cartesian3[] = [Cartesian3.ZERO, Cartesian3.ZERO], plumeArr: Cartesian3[] = [Cartesian3.ZERO, Cartesian3.ZERO];
    const axArr = [0, 1, 2].map(() => [Cartesian3.ZERO, Cartesian3.ZERO]);
    const coneArr = [0, 1, 2, 3].map(() => [Cartesian3.ZERO, Cartesian3.ZERO]);
    const footPts: Cartesian3[] = [];
    // Earth umbra cone (translucent), pointing away from the Sun; length 6e7 m (umbra is 1.4e9 m long, truncated for rendering).
    const SH_L = 6e7, SH_SLOPE = (6.957e8 - R_EARTH) / 1.496e11;
    this.shadow = v.entities.add({
      position: new CallbackProperty(() => this.shadowState.pos, false) as never, orientation: new CallbackProperty(() => this.shadowState.q, false) as never,
      cylinder: { length: SH_L, bottomRadius: R_EARTH, topRadius: R_EARTH - SH_L * SH_SLOPE, material: Color.BLACK.withAlpha(this.style.shadowOpacity), outline: false, numberOfVerticalLines: 0 }, show: false,
    });
    const velArr: Cartesian3[] = [Cartesian3.ZERO, Cartesian3.ZERO];
    const sunArr: Cartesian3[] = [Cartesian3.ZERO, Cartesian3.ZERO];
    const tag = (text: string, color: Color, get: () => Cartesian3) => v.entities.add({
      position: new CallbackProperty(get, false) as never,
      label: { text, font: '12px ui-monospace, monospace', fillColor: color, style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK, pixelOffset: new Cartesian2(0, -10), disableDepthTestDistance: 1e9 }, show: false,
    });
    this.fx = {
      velArr, velVec: line(Color.CYAN, 3, () => velArr), sunArr, sunVec: line(Color.GOLD, 2, () => sunArr), axLabels: [tag('Body X', Color.RED, () => axArr[0][1]), tag('Body Y', Color.LIME, () => axArr[1][1]), tag('Body Z (nadir)', Color.DODGERBLUE, () => axArr[2][1]), tag('Sun', Color.GOLD, () => sunArr[1])],
      burnArr, plumeArr, axArr, coneArr, footPts,
      burnVec: line(Color.YELLOW, 3, () => burnArr), plume: line(Color.ORANGE, 9, () => plumeArr),
      axes: [Color.RED, Color.LIME, Color.DODGERBLUE].map((c, i) => line(c, 3, () => axArr[i])),
      cone: coneArr.map((a) => line(Color.CYAN.withAlpha(0.6), 1, () => a)),
      foot: v.entities.add({ polygon: { hierarchy: new CallbackProperty(() => new PolygonHierarchy(footPts), false), material: Color.CYAN.withAlpha(0.22), perPositionHeight: false, outline: false }, show: false }),
    };

    this.setLook('standard'); // after the shadow / fx entities exist
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
    for (const g of this.stns.values()) { const on = l.stations && !this.hidden.has(g.stn.id); g.entity.show = on; g.cone.show = on && l.visibilityCones; }
    this.saa.show = l.saa;
    if (scene.sun) scene.sun.show = l.sun;
    if (scene.moon) scene.moon.show = l.moon;
    if (scene.skyBox) scene.skyBox.show = l.stars;
    const sch0 = this.look === 'schematic';
    this.shadow.show = l.eclipseShadow;
    if (this.cloudLayer) this.cloudLayer.show = l.clouds && !sch0;
    if (this.terrain) this.applyTerrain();
    const sch = this.look === 'schematic';
    if (this.baseLayer) this.baseLayer.show = !sch;
    if (this.schLayer) this.schLayer.show = sch;
    if (this.hires) this.hires.show = l.hiresImagery && !sch;
    if (this.lights) this.lights.show = l.cityLights && !sch;
    for (const e of this.graticule) e.show = l.graticule;
    if (l.borders && !this.borders && !this.bordersLoading) this.buildBorders();
    if (this.borders) this.borders.show = l.borders;
    scene.backgroundColor = sch ? Color.fromCssColorString('#16171b') : Color.BLACK;
    if (this.heatLayer) { this.heatLayer.show = l.coverage; this.heatLayer.alpha = this.style.heatmapOpacity; }
    for (const x of this.effects) x.entity.show = l.eventEffects;
  }

  /**
   * 'standard': plain smooth Earth — no bloom/HDR/glow/city lights/clouds, default Cesium atmosphere, coarser tile LOD for a steady frame rate.
   * 'cinematic': HDR, bloom, per-fragment atmosphere, glowing orbit lines (city lights / clouds follow the layer toggles).
   */
  setLook(look: EarthLook): void {
    this.look = look;
    const sc = this.viewer.scene, cin = look === 'cinematic';
    if (this.layers) this.setLayers(this.layers);
    sc.highDynamicRange = cin;
    sc.globe.maximumScreenSpaceError = cin ? 1.2 : 2;
    sc.globe.dynamicAtmosphereLighting = true;
    sc.globe.dynamicAtmosphereLightingFromSun = cin;
    const bloom = sc.postProcessStages.bloom;
    bloom.enabled = cin;
    if (cin) { bloom.uniforms.brightness = -0.35; bloom.uniforms.contrast = 110; bloom.uniforms.glowOnly = false; }
    if (sc.skyAtmosphere) sc.skyAtmosphere.perFragmentAtmosphere = cin;
    this.setStyle(this.style);
  }

  /** Country boundaries as one PolylineCollection (single draw batch), built lazily from the bundled Natural Earth data. */
  private buildBorders(): void {
    this.bordersLoading = true;
    loadBorders().then((lines) => {
      if (this.disposed) return;
      const pc = new PolylineCollection();
      const mat = Material.fromType('Color', { color: Color.WHITE.withAlpha(0.9) });
      for (const l of lines) pc.add({ positions: Cartesian3.fromDegreesArrayHeights(l.flatMap(([lo, la]) => [lo, la, 1500])), width: 1.3, material: mat });
      this.viewer.scene.primitives.add(pc);
      this.borders = pc;
      pc.show = this.layers?.borders ?? true;
    }).catch((e) => { console.error('borders failed', e); this.bordersLoading = false; });
  }

  /** Realistic vs colour-coded subsystem (cut-away) view for models that provide it. */
  setModelStyle(style: ModelStyle): void {
    for (const s of this.sats.values()) if (s.entity.model && s.kind) s.entity.model.uri = new ConstantProperty(modelUrl(s.kind, style).url) as never;
  }

  private applyTerrain(): void {
    const want = (this.layers?.terrain ?? true) && this.look !== 'schematic';
    const prov = want && this.terrain ? this.terrain : this.flat;
    if (this.viewer.scene.terrainProvider !== prov) this.viewer.scene.terrainProvider = prov;
  }

  /** Appearance settings (line widths / opacity / colours, atmosphere, terrain exaggeration). */
  setStyle(st: StyleSettings): void {
    this.style = st;
    const sc = this.viewer.scene;
    sc.verticalExaggeration = st.exaggeration;
    const cin = this.look === 'cinematic';
    sc.globe.atmosphereLightIntensity = (cin ? 14 : 10) * st.atmosphere;
    if (sc.skyAtmosphere) sc.skyAtmosphere.atmosphereLightIntensity = (cin ? 60 : 50) * st.atmosphere;
    if (this.cloudLayer) this.cloudLayer.alpha = st.cloudOpacity;
    if (this.heatLayer) this.heatLayer.alpha = st.heatmapOpacity;
    this.shadow.cylinder!.material = new ColorMaterialProperty(Color.BLACK.withAlpha(st.shadowOpacity)) as never;
    for (const s of this.sats.values()) this.applyStyleTo(s);
    for (const s of this.sats.values()) for (const l of s.links.values()) l.entity.polyline!.material = new ColorMaterialProperty(Color.fromCssColorString(st.linkColor).withAlpha(0.9)) as never;
  }

  private applyStyleTo(s: Sat3D): void {
    if (s.light) return;
    const st = this.style, c = Color.fromCssColorString(s.sat.color), e = s.entities;
    const set = (en: Entity | undefined, width: number, mat: unknown) => { if (en?.polyline) { en.polyline.width = width as never; en.polyline.material = mat as never; } };
    if (this.look === 'schematic') {
      // thin light-grey orbit rings tinted by the satellite colour (technical-diagram style)
      const g = Color.lerp(Color.fromCssColorString('#d8dee9'), c, 0.35, new Color());
      set(e.orbitPast, 1, new ColorMaterialProperty(g.withAlpha(0.3)));
      set(e.orbitFuture, Math.max(1, st.orbitWidth * 0.6), new ColorMaterialProperty(g.withAlpha(0.85)));
      set(e.gtPast, st.trackWidth * 0.6, new ColorMaterialProperty(Color.WHITE.withAlpha(st.trackOpacity * 0.4)));
      set(e.gtFuture, st.trackWidth, new PolylineDashMaterialProperty({ color: Color.fromCssColorString(st.trackColor).withAlpha(st.trackOpacity), dashLength: 12 }));
      if (s.foot?.polygon) s.foot.polygon.material = new ColorMaterialProperty(c.withAlpha(st.footprintOpacity)) as never;
      return;
    }
    set(e.orbitPast, st.orbitWidth * 0.75, new ColorMaterialProperty(c.withAlpha(st.orbitOpacity * 0.37)));
    set(e.orbitFuture, this.look === 'cinematic' ? st.orbitWidth * 3 : st.orbitWidth, this.look === 'cinematic' ? new PolylineGlowMaterialProperty({ glowPower: 0.22, color: c.withAlpha(st.orbitOpacity) }) : new ColorMaterialProperty(c.withAlpha(st.orbitOpacity)));
    set(e.gtPast, st.trackWidth * 0.75, new ColorMaterialProperty(Color.WHITE.withAlpha(st.trackOpacity * 0.4)));
    set(e.gtFuture, st.trackWidth, new PolylineDashMaterialProperty({ color: Color.fromCssColorString(st.trackColor).withAlpha(st.trackOpacity), dashLength: 12 }));
    if (s.foot?.polygon) s.foot.polygon.material = new ColorMaterialProperty(c.withAlpha(st.footprintOpacity)) as never;
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const [sid, s] of this.sats) if (s.entity.point && !s.light) s.entity.point.pixelSize = (sid === id ? 12 : 8) as never;
  }

  /** Object-browser visibility: ids of satellites / stations switched off individually. */
  setHidden(ids: string[]): void { this.hidden = new Set(ids); if (this.layers) this.setLayers(this.layers); }

  setPickMode(b: boolean): void { this.pickMode = b; this.viewer.scene.canvas.style.cursor = b ? 'crosshair' : ''; }

  setOverlayProvider(p: (() => Overlay) | null): void { this.overlayProvider = p; }

  setTarget(t: { lat: number; lon: number; radiusKm?: number } | null): void {
    if (this.targetEntity) { this.viewer.entities.remove(this.targetEntity); this.targetEntity = null; }
    if (!t) return;
    this.targetEntity = this.viewer.entities.add({
      position: Cartesian3.fromDegrees(t.lon, t.lat, 0),
      ellipse: t.radiusKm && t.radiusKm > 0 ? { semiMajorAxis: t.radiusKm * 1000, semiMinorAxis: t.radiusKm * 1000, material: Color.MAGENTA.withAlpha(0.22), outline: true, outlineColor: Color.MAGENTA, height: 0 } : undefined,
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
    // camera distance from the model in units of its bounding radius: follow ≈ 5R (context), closeup ≈ 2.3R (model fills the view)
    const mult = mode === 'closeup' ? 2.3 : 5;
    for (const s3 of this.sats.values()) if (s3.entity.model) { const r = modelUrl(s3.kind!).radius; s3.entity.viewFrom = new ConstantProperty(mode === 'closeup' ? new Cartesian3(r * mult * 0.75, -r * mult * 0.9, r * mult * 0.55) : new Cartesian3(0, -r * mult, r * mult * 0.5)); }
    if ((mode === 'follow' || mode === 'closeup') && this.selectedId && this.sats.has(this.selectedId)) v.trackedEntity = this.sats.get(this.selectedId)!.entity;
    else if (mode === 'earth' || mode === 'thailand') {
      // explicit heading/pitch/roll → always north-up (a plain flyTo would keep the previous, possibly rolled, orientation)
      v.camera.flyTo({ destination: Cartesian3.fromDegrees(THAI.lon, THAI.lat, mode === 'earth' ? THAI.overview : THAI.close), orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }, duration: 1.8 });
    }
    else if (mode === 'leo' || mode === 'coverage') {
      const sel = this.selectedId ? this.sats.get(this.selectedId) : undefined;
      const st = sel ? propagateSatellite(sel.sat, this.clock.time) : null;
      const g = st ? ecefToGeodetic(eciToEcef(st.r, this.clock.time)) : { lat: 0.2, lon: 1.7, alt: 5e5 };
      if (mode === 'leo') {
        // low-Earth-orbit viewpoint: ~1500 km above a point 12° behind the satellite's sub-point, looking forward along the horizon
        v.camera.flyTo({ destination: Cartesian3.fromRadians(g.lon, g.lat - 0.2, 1.6e6), orientation: { heading: 0, pitch: CesiumMath.toRadians(-28), roll: 0 }, duration: 2.5 });
      } else {
        // global coverage view: whole disc centred on the satellite / region, footprints + heatmap visible
        v.camera.flyTo({ destination: Cartesian3.fromRadians(g.lon, g.lat * 0.6, 2.6e7), duration: 2.5 });
      }
    } else this.camBlendStart = performance.now(); // per-frame modes: blend from the current pose
  }

  /** Home: fly back to the start view (straight down over Thailand, north up), releasing any camera tracking. */
  goHome(duration = 1.6): void {
    const v = this.viewer;
    this.camMode = 'thailand';
    v.trackedEntity = undefined;
    v.camera.lookAtTransform(Matrix4.IDENTITY);
    v.camera.flyTo({ destination: Cartesian3.fromDegrees(THAI.lon, THAI.lat, THAI.close), orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }, duration });
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
    let up = Cartesian3.normalize(Cartesian3.subtract(upHint, Cartesian3.multiplyByScalar(dir, k, new Cartesian3()), new Cartesian3()), new Cartesian3());
    const cam = this.viewer.camera;
    // smooth transition: ease the pose from where the camera was when the mode was selected (1.6 s, smoothstep)
    const f = Math.min(1, (performance.now() - this.camBlendStart) / 1600), e = f * f * (3 - 2 * f);
    let dst = pos, dr = dir;
    if (f < 1) {
      dst = Cartesian3.lerp(cam.positionWC, pos, e, new Cartesian3());
      dr = Cartesian3.normalize(Cartesian3.lerp(cam.directionWC, dir, e, new Cartesian3()), new Cartesian3());
      const u2 = Cartesian3.lerp(cam.upWC, up, e, new Cartesian3());
      const kk = Cartesian3.dot(u2, dr);
      up = Cartesian3.normalize(Cartesian3.subtract(u2, Cartesian3.multiplyByScalar(dr, kk, new Cartesian3()), new Cartesian3()), new Cartesian3());
    }
    cam.setView({ destination: dst, orientation: { direction: dr, up } });
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
      entity.viewFrom = new ConstantProperty(new Cartesian3(0, -m.radius * 5, m.radius * 2.5)); // replaced per camera mode
    }
    const s3: Sat3D = { sat, light, kind, entity, pos, extras: [], arrays, entities: {}, cache: null, links: new Map(), cart: new Cartesian3(), surf: new Cartesian3(), footPts: [], pools: { past: [], fut: [], gtp: [], gtf: [], ghost: [] } };
    arrays.nadir = [s3.cart, s3.surf];
    if (light) return s3;
    if (propsOf(sat).sensorHalfAngle) {
      // sensor ground footprint for EVERY satellite that has a sensor (multi-satellite coverage view)
      s3.foot = v.entities.add({ polygon: { hierarchy: new CallbackProperty(() => new PolygonHierarchy(s3.footPts), false), material: color.withAlpha(this.style.footprintOpacity), perPositionHeight: false, outline: false }, show: false });
    }
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
    this.applyStyleTo(s3);
    return s3;
  }

  private removeSat(s: Sat3D): void {
    const v = this.viewer;
    [s.entity, s.foot, ...Object.values(s.entities), ...[...s.links.values()].map((l) => l.entity)].forEach((e) => e && v.entities.remove(e));
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
      if (!st || this.hidden.has(s3.sat.id)) { s3.entity.show = false; for (const e of Object.values(s3.entities)) if (e) e.show = false; for (const l of s3.links.values()) l.entity.show = false; continue; }
      const rE = eciToEcef(st.r, t);
      const cart = s3.cart; cart.x = rE[0]; cart.y = rE[1]; cart.z = rE[2];
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
      const geo = ecefToGeodetic(rE);
      Cartesian3.fromRadians(geo.lon, geo.lat, 0, Ellipsoid.WGS84, s3.surf);
      s3.nadirPos!.setValue(s3.surf);
      // footprint polygon of this satellite's sensor (attitude-aware)
      const alpha = propsOf(s3.sat).sensorHalfAngle;
      if (s3.foot) {
        const on = !!alpha && !!qb && (L?.footprints ?? true);
        let ok = false;
        if (on && qb) {
          const bore = eciToEcef(quatRotate(qb, [0, 0, 1]), t);
          const ring = sensorFootprint(rE, bore, alpha!, 40);
          if (ring.every((p) => p)) { s3.footPts.length = 0; for (const p of ring as Vec3[]) s3.footPts.push(new Cartesian3(p[0], p[1], p[2])); ok = true; }
        }
        s3.foot.show = ok;
      }
      this.refreshPaths(s3, t, c, sn);
      this.updateLinks(s3, cart, rE);
      if (s3.sat.id === this.selectedId) {
        const R = Math.hypot(...rE);
        for (const g of this.stns.values()) g.coneRadius.v = R_EARTH * visibilityCentralAngle(R_EARTH, R, g.stn.minElevation);
      }
    }
    // Earth umbra cone: axis = anti-Sun direction (ECEF), centred L/2 behind Earth's centre
    if (this.layers?.eclipseShadow) {
      const sd = eciToEcef(sunPositionEci(t), t), sn2 = Math.hypot(...sd), d: Vec3 = [-sd[0] / sn2, -sd[1] / sn2, -sd[2] / sn2];
      const L2 = 6e7 / 2;
      this.shadowState.pos = new Cartesian3(d[0] * L2, d[1] * L2, d[2] * L2);
      // rotate the cylinder's +Z axis onto d
      const ax: Vec3 = [-d[1], d[0], 0], an = Math.hypot(...ax), ang = Math.acos(Math.max(-1, Math.min(1, d[2])));
      this.shadowState.q = an < 1e-9 ? (d[2] > 0 ? Quaternion.IDENTITY : Quaternion.fromAxisAngle(Cartesian3.UNIT_X, Math.PI)) : Quaternion.fromAxisAngle(new Cartesian3(ax[0] / an, ax[1] / an, ax[2] / an), ang);
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
    // procedural clouds are only credible from far away: fade them out when the camera is within a few thousand km of the surface
    if (this.cloudLayer) {
      const hgt = v.camera.positionCartographic.height, f = Math.min(1, Math.max(0, (hgt - 2.0e6) / 5.0e6));
      this.cloudLayer.alpha = this.style.cloudOpacity * f * f * (3 - 2 * f);
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
    const hide = () => { fx.velVec.show = false; fx.sunVec.show = false; fx.axLabels.forEach((a) => (a.show = false)); fx.burnVec.show = fx.plume.show = fx.foot.show = false; fx.axes.forEach((a) => (a.show = false)); fx.cone.forEach((a) => (a.show = false)); };
    if (!s3 || !cur || s3.light) return hide();
    const st = propagateSatellite(s3.sat, t);
    if (!st) return hide();
    const rot = (x: Vec3): Vec3 => eciToEcef(x, t);
    const P = cur.cart;
    const add = (d: Vec3, len: number) => new Cartesian3(P.x + d[0] * len, P.y + d[1] * len, P.z + d[2] * len);
    const L = this.layers;
    // velocity vector (ECEF-rotated inertial velocity direction), length 900 km
    fx.velVec.show = L?.velocityVector ?? true;
    { const vE = rot(st.v), vn = Math.hypot(...vE); fx.velArr[0] = P; fx.velArr[1] = add([vE[0] / vn, vE[1] / vn, vE[2] / vn], 900_000); }
    // burn
    const burn = activeBurn(s3.sat.maneuvers, t);
    fx.burnVec.show = fx.plume.show = !!burn && (L?.eventEffects ?? true);
    if (burn) {
      const d = rot(burnDirection(burn.direction, st.r, st.v));
      fx.burnArr[0] = P; fx.burnArr[1] = add(d, 600_000);
      fx.plumeArr[0] = P; fx.plumeArr[1] = add(d, -250_000);
    }
    // attitude axes & sensor
    const q = attitudeAt(s3.sat.attitude, t, (tt): AttitudeContext | null => { const s = propagateSatellite(s3.sat, tt); return s ? { r: s.r, v: s.v, sunEci: sunPositionEci(tt), utcMs: tt } : null; });
    // body axes, Sun vector and their labels only make sense when the camera is near the spacecraft
    const showAx = !!q && (L?.bodyAxes ?? true) && (this.camMode === 'follow' || this.camMode === 'closeup');
    fx.axes.forEach((a) => (a.show = showAx));
    fx.axLabels.forEach((a) => (a.show = showAx));
    fx.sunVec.show = showAx;
    if (showAx) { const sd = rot(sunPositionEci(t)); const sn = Math.hypot(...sd); fx.sunArr[0] = P; fx.sunArr[1] = add([sd[0] / sn, sd[1] / sn, sd[2] / sn], 900_000); }
    if (q && showAx) ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).forEach((ax, i) => { fx.axArr[i][0] = P; fx.axArr[i][1] = add(rot(quatRotate(q, ax)), 700_000); });
    const alpha = propsOf(s3.sat).sensorHalfAngle;
    const showSensor = !!q && !!alpha && (L?.footprints ?? true);
    fx.foot.show = false; fx.cone.forEach((a) => (a.show = showSensor));
    if (q && alpha && showSensor) {
      const bore = rot(quatRotate(q, [0, 0, 1]));
      const ring = sensorFootprint(cur.rE, bore, alpha, 48);
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
    const P = cache.period * 1000, pl = s3.pools;
    // fill pooled Cartesian3 objects in place (no allocation per frame except the small slice arrays)
    const put = (pool: Cartesian3[], i: number, x: number, y: number, z: number): void => { const o = pool[i]; if (o) { o.x = x; o.y = y; o.z = z; } else pool[i] = new Cartesian3(x, y, z); };
    const putGeo = (pool: Cartesian3[], i: number, lon: number, lat: number): void => { const o = pool[i] ?? (pool[i] = new Cartesian3()); Cartesian3.fromRadians(lon, lat, 2000, Ellipsoid.WGS84, o); };
    let np = 1, nf = 1, ngp = 1, ngf = 1; // index 0 reserved for the current position / nadir point
    for (const p of cache.samples) {
      const dt = p.t - t;
      if (dt < -P * 0.5 || dt > P) continue;
      const r = p.rEci, x = c * r[0] + sn * r[1], y = -sn * r[0] + c * r[1];
      if (dt <= 0) { put(pl.past, np, x, y, r[2]); putGeo(pl.gtp, ngp, p.geo.lon, p.geo.lat); np++; ngp++; }
      else { put(pl.fut, nf, x, y, r[2]); putGeo(pl.gtf, ngf, p.geo.lon, p.geo.lat); nf++; ngf++; }
    }
    pl.past[0] = pl.fut[0] = s3.cart; pl.gtp[0] = pl.gtf[0] = s3.surf;
    // past path runs old→now: put "now" at the end; future runs now→later: "now" is index 0 already
    const past = pl.past.slice(1, np); past.push(s3.cart);
    const gtp = pl.gtp.slice(1, ngp); gtp.push(s3.surf);
    s3.arrays.orbitPast = past; s3.arrays.orbitFuture = pl.fut.slice(0, nf); s3.arrays.gtPast = gtp; s3.arrays.gtFuture = pl.gtf.slice(0, ngf);
    let ng = 0;
    for (const p of cache.ghost) if (p.t >= t - P * 0.5 && p.t <= t + P) put(pl.ghost, ng++, c * p.rEci[0] + sn * p.rEci[1], -sn * p.rEci[0] + c * p.rEci[1], p.rEci[2]);
    s3.arrays.ghost = pl.ghost.slice(0, ng);
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

