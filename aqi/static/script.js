
    let viewer;
    const DEFAULT_BASEMAP = 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png';
    let baseLayer = null;

    // 3D tiles refs
    let googleTileset = null;
    let osmBuildings = null;

    // DSM refs
    let dsmLayer = null;
    let dsmTileset = null;

    // IDW imagery layers
    let aqiHeatmap = null;
    let tempHeatmap = null;
    let bikesHeatmap = null;

    // Mode-specific click handlers/entities
    let aqiClickHandler = null, aqiProbeEntity = null;
    let tempClickHandler = null;

    // IDW contexts (for sampling or legend if needed)
    window.AQI_IDW = null;
    window.TEMP_IDW = null;
    window.BIKES_IDW = null;

    async function startViewer() {
      Cesium.Ion.defaultAccessToken = "{{ CESIUM_ION_TOKEN }}";

      viewer = new Cesium.Viewer("cesiumContainer", {
        terrain: Cesium.Terrain.DEFAULT,
        imageryProvider: new Cesium.UrlTemplateImageryProvider({ url: DEFAULT_BASEMAP }),
        baseLayerPicker: true, infoBox: true, selectionIndicator: true,
        sceneMode: Cesium.SceneMode.SCENE3D, geocoder: false, timeline: false, animation: false
      });

      baseLayer = viewer.imageryLayers.get(0);
      viewer.scene.globe.verticalExaggeration = 100.0;
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(133.8, -25.3, 2500000) });

      wireUI();
      wireLiveButton();
      wireMeasureButton();
      wireResetButton();
      wireExploreGeneric();
    }

    // ---------- Measure tool ----------
    let measureActive=false, measureHandler=null, measureFirstPos=null, measureLine=null, measureLabel=null;
    function wireMeasureButton() {
      document.getElementById('btnMeasure').onclick = () => { if (measureActive) deactivateMeasure(); else activateMeasure(); };
    }
    function activateMeasure() {
      measureActive = true;
      if (measureHandler) measureHandler.destroy();
      measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      measureHandler.setInputAction((click) => {
        const cartesian = viewer.scene.pickPosition(click.position)
          || viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (!cartesian) return;
        if (!measureFirstPos) {
          measureFirstPos = cartesian;
          viewer.entities.add({ id: "measure-start", position: measureFirstPos,
            point: { pixelSize: 8, color: Cesium.Color.LIME, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 }});
        } else {
          const secondPos = cartesian;
          const km = computeGeodesicDistanceKm(measureFirstPos, secondPos);
          if (measureLine) viewer.entities.remove(measureLine);
          measureLine = viewer.entities.add({ polyline: { positions: [measureFirstPos, secondPos], width: 3, material: Cesium.Color.YELLOW }});
          const mid = Cesium.Cartesian3.midpoint(measureFirstPos, secondPos, new Cesium.Cartesian3());
          if (measureLabel) viewer.entities.remove(measureLabel);
          measureLabel = viewer.entities.add({
            position: mid, label: { text: `${km.toFixed(2)} km`, font: "bold 14px sans-serif", fillColor: Cesium.Color.WHITE,
            showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.6), pixelOffset: new Cesium.Cartesian2(0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY }});
          viewer.entities.removeById("measure-start");
          measureFirstPos = null; deactivateMeasure(true);
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
    function deactivateMeasure(keepGraphics=false){
      measureActive=false;
      if (measureHandler) { measureHandler.destroy(); measureHandler=null; }
      if (!keepGraphics) {
        viewer.entities.removeById("measure-start");
        if (measureLine)  { viewer.entities.remove(measureLine);  measureLine=null; }
        if (measureLabel) { viewer.entities.remove(measureLabel); measureLabel=null; }
      }
    }
    function computeGeodesicDistanceKm(a,b){
      const e=Cesium.Ellipsoid.WGS84, ca=e.cartesianToCartographic(a), cb=e.cartesianToCartographic(b);
      return new Cesium.EllipsoidGeodesic(ca, cb).surfaceDistance/1000.0;
    }

    // ---------- Cleanup (preserve basemap) ----------
    async function clearAllOverlays() {
      try { if (Cesium.Terrain && Cesium.Terrain.DEFAULT) viewer.terrain = Cesium.Terrain.DEFAULT; } catch {}

      // 3D tiles + DSM
      try {
        if (dsmLayer)   { try { viewer.imageryLayers.remove(dsmLayer, true); } catch {} dsmLayer = null; }
        if (dsmTileset) { viewer.scene.primitives.remove(dsmTileset); dsmTileset = null; }
        if (googleTileset) { viewer.scene.primitives.remove(googleTileset); googleTileset = null; }
        if (osmBuildings)  { viewer.scene.primitives.remove(osmBuildings);  osmBuildings  = null; }
      } catch(e){}

      // Heatmap layers
      try {
        if (aqiHeatmap)   { viewer.imageryLayers.remove(aqiHeatmap, true);   aqiHeatmap = null; }
        if (tempHeatmap)  { viewer.imageryLayers.remove(tempHeatmap, true);  tempHeatmap = null; }
        if (bikesHeatmap) { viewer.imageryLayers.remove(bikesHeatmap, true); bikesHeatmap = null; }
      } catch(e){}

      // Click handlers
      disableAQIClickSampling();
      disableTempClickCharts();
      disableBikeClickSampling();

      window.AQI_IDW = null;
      window.TEMP_IDW = null;
      window.BIKES_IDW = null;

      try {
        viewer.entities.removeAll();
        viewer.dataSources.removeAll();
        const layers = viewer.imageryLayers;
        for (let i = layers.length - 1; i >= 1; i--) layers.remove(layers.get(i), true);
        baseLayer = layers.get(0);
      } catch(err){ console.error("[clearAllOverlays] failed:", err); }
    }

    // ---------- Explore wiring ----------
    async function flyToLondon() {
      return viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-0.1, 51.5, 1500.0),
        duration: 1.3
      });
    }
    function wireExploreGeneric() {
      const items = Array.from(document.querySelectorAll('.explore-item'));
      const setDisabled = (yes) => items.forEach(el => el.classList.toggle('disabled', !!yes));
      const setActive = (activeEl) => items.forEach(el => el.classList.toggle('active', el === activeEl));

      items.forEach(el => {
        el.onclick = async () => {
          const key = el.getAttribute('data-layer');
          const loader = LAYERS[key];
          if (!loader) return;
          setDisabled(true); setActive(null);
          await clearAllOverlays();
          try { await loader(); setActive(el); }
          catch (e) { console.error(`[explore:${key}] load failed`, e); alert(`Failed to load ${key}.`); }
          finally { setDisabled(false); }
        };
      });
    }
    function wireResetButton(){
      document.getElementById('btnReset').onclick = async () => {
        await clearAllOverlays();
        viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(0, 20, 20000000), duration: 1.0 });
        document.querySelectorAll('.explore-item').forEach(el => el.classList.remove('active'));
      };
    }
    function wireLiveButton(){ document.getElementById('btnLive').onclick = onLocate; }
    async function onLocate(){
      if (!navigator.geolocation) return alert("Geolocation not supported by this browser.");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude, lon = pos.coords.
          longitude;
          if (viewer.entities.getById("live-location")) viewer.entities.removeById("live-location");
          viewer.entities.add({
            id: "live-location", position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: { pixelSize: 12, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
            label: { text: "You are here", font: "bold 12px sans-serif", fillColor: Cesium.Color.WHITE,
              showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
              pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY }
          });
          viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1200), duration: 1.6 });
        },
        () => alert("Unable to get location. Allow permissions and try again."),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
    function wireUI(){
      document.getElementById('openExplore').onclick = () => {
        const p = document.getElementById('explorePanel');
        p.style.display = (p.style.display === 'none') ? 'block' : 'none';
      };
      document.getElementById('openUpload').onclick = () => alert("Upload coming soon.");
      document.getElementById('takeTour').onclick = () => alert("Tour coming soon.");

      document.getElementById('btnHome').onclick = () =>
        viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(0, 20, 20000000), duration: 1.2 });
      document.getElementById('btnZoomIn').onclick = () => viewer.camera.zoomIn(1000.0);
      document.getElementById('btnZoomOut').onclick = () => viewer.camera.zoomOut(1000.0);

      document.getElementById('searchBtn').onclick = doSearch;
      document.getElementById('searchBox').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    }
    async function doSearch(){
      const q = document.getElementById('searchBox').value.trim();
      if (!q) return;
      try{
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' }});
        const j = await r.json();
        if (!j.length) return alert("No results.");
        const { lon, lat } = j[0];
        viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(parseFloat(lon), parseFloat(lat), 1200), duration:1.4 });
      }catch(e){ console.error(e); alert("Search failed."); }
    }

    // ---------- Generic IDW + color ramps ----------
    function hexToRgb(hex){ const s=hex.replace('#',''); const n=parseInt(s.length===3?s.split('').map(ch=>ch+ch).join(''):s,16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }
    function lerp(a,b,t){ return a+(b-a)*t; }
    function lerpColor(c1,c2,t){ return { r:Math.round(lerp(c1.r,c2.r,t)), g:Math.round(lerp(c1.g,c2.g,t)), b:Math.round(lerp(c1.b,c2.b,t)) }; }
    function makeValueToRGB(STOPS){
      return function(v){
        if (v <= STOPS[0].v) return hexToRgb(STOPS[0].c);
        for (let i=0;i<STOPS.length-1;i++){ const a=STOPS[i], b=STOPS[i+1];
          if (v <= b.v){ const t=(v-a.v)/(b.v-a.v); return lerpColor(hexToRgb(a.c), hexToRgb(b.c), t); } }
        return hexToRgb(STOPS[STOPS.length-1].c);
      };
    }
    // Ramps
    const AQI_STOPS   = [ {v:0,c:"#00e400"},{v:50,c:"#ffff00"},{v:100,c:"#ff9933"},{v:150,c:"#cc0033"},{v:200,c:"#660099"},{v:300,c:"#7e0023"} ];
    const TEMP_STOPS  = [ {v:-5,c:"#1e3a8a"},{v:0,c:"#60a5fa"},{v:10,c:"#22c55e"},{v:20,c:"#f59e0b"},{v:30,c:"#ef4444"},{v:40,c:"#991b1b"} ];
    const BIKES_STOPS = [ {v:0,c:"#ef4444"},{v:33,c:"#f59e0b"},{v:66,c:"#84cc16"},{v:100,c:"#16a34a"} ];

    /**
     * Render an IDW heatmap (value-only) to a data URL.
     * points: [{lon,lat,value}]
     * bbox:   {west,east,south,north}
     * opts:   {width,height,power,stops}
     */
    function renderIDWHeatmap(points, bbox, opts = {}) {
      const width  = opts.width  ?? 768;
      const height = opts.height ?? 768;
      const power  = opts.power  ?? 2;
      const eps    = 1e-6;
      const toRGB  = makeValueToRGB(opts.stops ?? AQI_STOPS);
      const { west, east, south, north } = bbox;

      const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
      const ctx=canvas.getContext('2d',{ willReadFrequently:true });
      const img=ctx.createImageData(width,height);

      const pts = points.map(p => ({
        x:(p.lon-west)/(east-west)*(width-1),
        y:(1-(p.lat-south)/(north-south))*(height-1),
        v:p.value
      }));

      let idx = 0;
      for (let j=0;j<height;j++){
        for (let i=0;i<width;i++){
          let num=0, den=0, val=0;
          for (let k=0;k<pts.length;k++){
            const dx=i-pts[k].x, dy=j-pts[k].y, d2=dx*dx+dy*dy;
            if (d2 < 1) { val = pts[k].v; den=1; num=val; break; }
            const w = 1 / Math.pow(d2 + eps, power/2);
            num += w * pts[k].v; den += w;
          }
          val = den>0 ? num/den : 0;

          const {r,g,b} = toRGB(val);
          img.data[idx++] = r;
          img.data[idx++] = g;
          img.data[idx++] = b;
          img.data[idx++] = 200; // alpha of the PNG; layer alpha multiplies this
        }
      }
      ctx.putImageData(img,0,0);
      return canvas.toDataURL('image/png');
    }

    // ---------- AQI (IDW + sampling + WAQI popup) ----------
    function enableAQIClickSampling(){
      disableAQIClickSampling();
      aqiClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      aqiClickHandler.setInputAction(async (click) => {
        const picked = viewer.scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id && picked.id._waqi) {
          await showWaqiStationPopup(picked.id);
          return;
        }
        const cart = viewer.scene.pickPosition(click.position) || viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (!cart || !window.AQI_IDW) return;
        const c = Cesium.Cartographic.fromCartesian(cart);
        const lon = Cesium.Math.toDegrees(c.longitude);
        const lat = Cesium.Math.toDegrees(c.latitude);
        const val = sampleIDWAt(window.AQI_IDW, lon, lat);
        if (val == null) return;

        if (aqiProbeEntity) viewer.entities.remove(aqiProbeEntity);
        aqiProbeEntity = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: { pixelSize: 10, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
          label: {
            text: `AQI ~ ${val.toFixed(0)}`, font: "bold 13px sans-serif",
            fillColor: Cesium.Color.BLACK, showBackground: true,
            backgroundColor: Cesium.Color.WHITE.withAlpha(0.9),
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          description: `
            <div style="font-family:system-ui;line-height:1.3">
              <div style="font-weight:700;margin-bottom:6px;">Interpolated AQI</div>
              <div style="font-size:28px;font-weight:800;margin-bottom:4px;">${val.toFixed(1)}</div>
              <div><b>Location:</b> ${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
              <div style="opacity:.7;margin-top:6px;">Computed via IDW (value-only)</div>
            </div>`
        });
        viewer.selectedEntity = aqiProbeEntity;
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
    function disableAQIClickSampling(){
      if (aqiClickHandler) { aqiClickHandler.destroy(); aqiClickHandler = null; }
      if (aqiProbeEntity) { try { viewer.entities.remove(aqiProbeEntity); } catch{} aqiProbeEntity=null; }
    }
    function sampleIDWAt(ctx, lon, lat){
      const { points,bbox,power,width,height }=ctx; const { west,east,south,north }=bbox;
      const x=(lon-west)/(east-west)*(width-1), y=(1-(lat-south)/(north-south))*(height-1);
      let num=0,den=0; const eps=1e-6;
      for(const p of points){
        const px=(p.lon-west)/(east-west)*(width-1), py=(1-(p.lat-south)/(north-south))*(height-1);
        const dx=x-px, dy=y-py, d2=dx*dx+dy*dy; if(d2<1) return p.value;
        const w=1/Math.pow(d2+eps,power/2); num+=w*p.value; den+=w;
      }
      return den>0 ? num/den : null;
    }
    async function showWaqiStationPopup(entity){
      entity.description = `<div style="font-family:system-ui">Loading station data…</div>`;
      viewer.selectedEntity = entity;
      const uid = entity._waqi.uid;
      const token = "{{ WAQI_TOKEN }}";
      const url = `https://api.waqi.info/feed/@${uid}/?token=${token}`;
      try{
        const r = await fetch(url);
        const j = await r.json();
        if (j.status !== "ok") throw new Error("WAQI details error");
        const d = j.data || {};
        const iaqi = d.iaqi || {};
        const fmt = (x, suffix='') => (x && typeof x.v !== 'undefined') ? `${x.v}${suffix}` : '—';
        entity.description = `
          <div style="font-family:system-ui;line-height:1.35">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="font-weight:800">${d.city?.name || entity.name || 'Station'}</div>
              <div style="font-size:22px;font-weight:900;">AQI ${d.aqi ?? entity._waqi.aqi ?? '—'}</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
              ${['pm25','pm10','o3','no2','so2','co','t','h','w'].map(key => {
                const lab = {pm25:'PM2.5',pm10:'PM10',o3:'O₃',no2:'NO₂',so2:'SO₂',co:'CO',t:'Temp',h:'Humidity',w:'Wind'}[key];
                const suf = {t:'°C',h:'%',w:' m/s'}[key] || '';
                return `<div style="background:#0f172a;color:#e2e8f0;padding:8px;border-radius:8px"><div style="opacity:.7;">${lab}</div><div style="font-weight:800">${fmt(iaqi[key],suf)}</div></div>`;
              }).join('')}
            </div>
            <div style="margin-top:8px;opacity:.7;">Dominant pollutant: ${d.dominentpol ?? '—'} · Time: ${d.time?.s ?? '—'}</div>
          </div>`;
      }catch(e){
        entity.description = `<div style="font-family:system-ui;color:#ef4444">Failed to load station details.</div>`;
        console.error(e);
      }
    }

    async function loadAQI() {
      const API_KEY = "{{ WAQI_TOKEN }}";
      const bboxStr = "{{ WAQI_BBOX }}"; // "south,west,north,east"
      let south=51.3, west=-0.5, north=51.7, east=0.3;
      if (bboxStr && bboxStr.split(',').length === 4) {
        const [s,w,n,e] = bboxStr.split(',').map(parseFloat);
        if ([s,w,n,e].every(v => !isNaN(v))) { south=s; west=w; north=n; east=e; }
      }
      const bboxUrl = `https://api.waqi.info/map/bounds/?token=${API_KEY}&latlng=${south},${west},${north},${east}`;

      const res = await fetch(bboxUrl); const data = await res.json();
      if (data.status !== "ok") { console.error("AQI API error:", data); return; }

      const points = [];
      for (const st of data.data) {
        const aqi = parseInt(st.aqi);
        if (isNaN(aqi) || aqi < 0) continue;
        points.push({ lon: st.lon, lat: st.lat, value: aqi });

        const colorCss = (aqi<=50) ? "#009966" : (aqi<=100) ? "#ffde33" : (aqi<=150) ? "#ff9933" :
                         (aqi<=200) ? "#cc0033" : (aqi<=300) ? "#660099" : "#7e0023";
        const color = Cesium.Color.fromCssColorString(colorCss);
        const ent = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(st.lon, st.lat),
          point: { pixelSize: 10, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
          label: {
            text: aqi.toString(), font: "bold 12px sans-serif", fillColor: Cesium.Color.BLACK,
            showBackground: true, backgroundColor: color.withAlpha(0.85),
            pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          name: st.station?.name || "AQI Station"
        });
        ent._waqi = { uid: st.uid, aqi, name: st.station?.name || null };
      }

      if (points.length) {
        const width=768,height=768,power=2;
        const url = renderIDWHeatmap(points, { west, east, south, north }, { width, height, power, stops: AQI_STOPS });
        const rectangle = Cesium.Rectangle.fromDegrees(west, south, east, north);
        const provider  = new Cesium.SingleTileImageryProvider({ url, rectangle });
        aqiHeatmap = viewer.imageryLayers.addImageryProvider(provider);
        aqiHeatmap.alpha = 0.45;
        viewer.imageryLayers.raiseToTop(aqiHeatmap);

        window.AQI_IDW = { points, bbox: { west, east, south, north }, power, width, height };
      }

      enableAQIClickSampling();
      console.log("[AQI] stations:", points.length);
    }


    let tempProbeEntity = null;
    let bikesProbeEntity = null;
    let bikesClickHandler = null;
    // ---------- Temperature (IDW + time-series bar chart on click) ----------
function disableTempClickCharts(){
  if (tempClickHandler){ tempClickHandler.destroy(); tempClickHandler=null; }
  if (tempProbeEntity){ try { viewer.entities.remove(tempProbeEntity); } catch{} tempProbeEntity=null; }
}

function enableTempClickCharts(){
  disableTempClickCharts();
  tempClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  tempClickHandler.setInputAction(async (click) => {
    const picked = viewer.scene.pick(click.position);

    // 1) If a temperature station is clicked -> fetch & show time series bar chart
    if (Cesium.defined(picked) && picked.id && picked.id._temp) {
      const ent = picked.id;
      const { lat, lon } = ent._temp;
      ent.description = `<div style="font-family:system-ui">Loading time series…</div>`;
      viewer.selectedEntity = ent;

      try{
        const series = await fetchTempSeries(lat, lon);
        const svg = buildTempBarChartSVG(series.times, series.values);
        ent.description = `
          <div style="font-family:system-ui;line-height:1.35">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div style="font-weight:800">${ent.name || 'Temperature'}</div>
              <div style="opacity:.8">${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
            </div>
            ${svg}
          </div>`;
      }catch(e){
        ent.description = `<div style="font-family:system-ui;color:#ef4444">Failed to load time series.</div>`;
        console.error(e);
      }
      return;
    }

    // 2) Else: sample the temperature IDW at the click location
    if (!window.TEMP_IDW) return;
    const cart = viewer.scene.pickPosition(click.position) || viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
    if (!cart) return;
    const c = Cesium.Cartographic.fromCartesian(cart);
    const lon = Cesium.Math.toDegrees(c.longitude);
    const lat = Cesium.Math.toDegrees(c.latitude);
    const val = sampleIDWAt(window.TEMP_IDW, lon, lat);
    if (val == null) return;

    if (tempProbeEntity) viewer.entities.remove(tempProbeEntity);
    tempProbeEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: { pixelSize: 10, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
      label: {
        text: `Temp ~ ${val.toFixed(1)}°C`,
        font: "bold 13px sans-serif",
        fillColor: Cesium.Color.BLACK,
        showBackground: true,
        backgroundColor: Cesium.Color.WHITE.withAlpha(0.9),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      description: `
        <div style="font-family:system-ui;line-height:1.3">
          <div style="font-weight:700;margin-bottom:6px;">Interpolated Temperature</div>
          <div style="font-size:28px;font-weight:800;margin-bottom:4px;">${val.toFixed(1)} °C</div>
          <div><b>Location:</b> ${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
          <div style="opacity:.7;margin-top:6px;">Computed via IDW (value-only)</div>
        </div>`
    });
    viewer.selectedEntity = tempProbeEntity;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

    
    async function fetchTempSeries(lat, lon){
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&past_days=1&forecast_days=1&timezone=auto`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("Open-Meteo error");
      const j = await r.json();
      const h = j?.hourly; if (!h?.time || !h?.temperature_2m) throw new Error("No hourly data");
      // use the last 24 hours (or all if less)
      const n = h.time.length;
      const start = Math.max(0, n - 24);
      return { times: h.time.slice(start), values: h.temperature_2m.slice(start) };
    }
    function buildTempBarChartSVG(timesISO, temps){
      const W=640, H=260, m={l:42,r:10,t:10,b:26}, iw=W-m.l-m.r, ih=H-m.t-m.b;
      const min = Math.min(...temps), max = Math.max(...temps);
      const pad = Math.max(1, (max-min)*0.1);
      const vmin = Math.floor(min - pad), vmax = Math.ceil(max + pad);
      const n = temps.length, gap = 2;
      const bw = Math.max(1, Math.floor((iw - gap*(n-1)) / n));
      const x = i => m.l + i*(bw+gap);
      const y = v => m.t + ih - ((v - vmin) / (vmax - vmin)) * ih;

      const toRGB = makeValueToRGB(TEMP_STOPS);
      const bars = temps.map((v,i) => {
        const {r,g,b} = toRGB(v);
        const _x=x(i), _y=y(v), h=Math.max(1, m.t+ih - _y);
        return `<rect x="${_x}" y="${_y}" width="${bw}" height="${h}" fill="rgb(${r},${g},${b})" />`;
      }).join('');

      // x labels every 3rd hour
      const labels = temps.map((_,i) => {
        if (i%3) return '';
        const d=new Date(timesISO[i]); const hh=String(d.getHours()).padStart(2,'0');
        return `<text x="${x(i)+bw/2}" y="${H-6}" font-size="10" text-anchor="middle" fill="#e5e7eb">${hh}</text>`;
      }).join('');

      // y axis ticks
      const yTicks = [];
      const steps = 4;
      for (let i=0;i<=steps;i++){
        const v = vmin + (i/steps)*(vmax-vmin);
        const yy = y(v);
        yTicks.push(
          `<line x1="${m.l-4}" y1="${yy}" x2="${W-m.r}" y2="${yy}" stroke="#334155" stroke-width="1" opacity="0.4"/>`+
          `<text x="${m.l-8}" y="${yy+3}" font-size="10" text-anchor="end" fill="#cbd5e1">${v.toFixed(0)}°</text>`
        );
      }

      return `
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#0b1220;border-radius:8px">
          <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1220"/>
          ${yTicks.join('')}
          ${bars}
          ${labels}
        </svg>
      `;
    }

    async function loadTemperature() {
      const API_KEY = "{{ WAQI_TOKEN }}";
      const bboxStr = "{{ WAQI_BBOX }}";
      let south=51.3, west=-0.5, north=51.7, east=0.3;
      if (bboxStr && bboxStr.split(',').length === 4) {
        const [s,w,n,e] = bboxStr.split(',').map(parseFloat);
        if ([s,w,n,e].every(v => !isNaN(v))) { south=s; west=w; north=n; east=e; }
      }
      const bboxUrl = `https://api.waqi.info/map/bounds/?token=${API_KEY}&latlng=${south},${west},${north},${east}`;

      const stRes = await fetch(bboxUrl);
      const stJson = await stRes.json();
      if (stJson.status !== "ok") { console.error("WAQI stations fetch failed for temperature:", stJson); return; }

      // fetch latest temp for each station (concurrency-limited)
      const stations = stJson.data;
      const points = [];
      let i=0; const limit=6;
      const workers = Array.from({length: limit}).map(async () => {
        while(i < stations.length){
          const st = stations[i++];
          try{
            const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}&hourly=temperature_2m&timezone=auto`);
            if (!r.ok) continue;
            const j = await r.json();
            const h = j?.hourly; if (!h?.time || !h?.temperature_2m) continue;
            const idx = h.time.length - 1;
            const tempC = h.temperature_2m[idx];
            if (typeof tempC !== "number") continue;

            // marker
            const color = (tempC<5)?Cesium.Color.fromCssColorString("#3b82f6")
                        :(tempC<15)?Cesium.Color.fromCssColorString("#22c55e")
                        :(tempC<25)?Cesium.Color.fromCssColorString("#f59e0b")
                                   :Cesium.Color.fromCssColorString("#ef4444");
            const ent = viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(st.lon, st.lat),
              point: { pixelSize: 10, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
              label: {
                text: `${tempC.toFixed(1)}°C`,
                font: "bold 12px sans-serif",
                fillColor: Cesium.Color.BLACK,
                showBackground: true,
                backgroundColor: color.withAlpha(0.85),
                pixelOffset: new Cesium.Cartesian2(0, -18),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
              },
              name: "Temperature station"
            });
            ent._temp = { lat: st.lat, lon: st.lon };

            // IDW point
            points.push({ lon: st.lon, lat: st.lat, value: tempC });
          }catch(e){ /* ignore station errors */ }
        }
      });
      await Promise.all(workers);

      // IDW overlay (temp)
      if (points.length){
        const width=768,height=768,power=2;
        const url = renderIDWHeatmap(points, { west, east, south, north }, { width, height, power, stops: TEMP_STOPS });
        const rectangle = Cesium.Rectangle.fromDegrees(west, south, east, north);
        const provider  = new Cesium.SingleTileImageryProvider({ url, rectangle });
        tempHeatmap = viewer.imageryLayers.addImageryProvider(provider);
        tempHeatmap.alpha = 0.45;
        viewer.imageryLayers.raiseToTop(tempHeatmap);

        window.TEMP_IDW = { points, bbox:{west,east,south,north}, power, width, height };
      }

      // enable click-to-open time series
      enableTempClickCharts();
      console.log("[TEMP] stations plotted:", points.length);
    }

    // ---------- Bikes (TfL) with IDW of availability ratio ----------



    function disableBikeClickSampling(){
  if (bikesClickHandler){ bikesClickHandler.destroy(); bikesClickHandler=null; }
  if (bikesProbeEntity){ try { viewer.entities.remove(bikesProbeEntity); } catch{} bikesProbeEntity=null; }
}

function enableBikeClickSampling(){
  disableBikeClickSampling();
  bikesClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  bikesClickHandler.setInputAction((click) => {
    // If a BikePoint entity was clicked, let Cesium's default selection show its description
    const picked = viewer.scene.pick(click.position);
    if (Cesium.defined(picked) && picked.id && !picked.id._temp && !picked.id._waqi) {
      return; // default popup for bike entity will show
    }

    // Otherwise sample the bikes IDW raster
    if (!window.BIKES_IDW) return;
    const cart = viewer.scene.pickPosition(click.position) || viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
    if (!cart) return;
    const c = Cesium.Cartographic.fromCartesian(cart);
    const lon = Cesium.Math.toDegrees(c.longitude);
    const lat = Cesium.Math.toDegrees(c.latitude);
    const val = sampleIDWAt(window.BIKES_IDW, lon, lat); // 0..100 (%)
    if (val == null) return;

    if (bikesProbeEntity) viewer.entities.remove(bikesProbeEntity);
    bikesProbeEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: { pixelSize: 10, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
      label: {
        text: `Avail ~ ${val.toFixed(0)}%`,
        font: "bold 13px sans-serif",
        fillColor: Cesium.Color.BLACK,
        showBackground: true,
        backgroundColor: Cesium.Color.WHITE.withAlpha(0.9),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      description: `
        <div style="font-family:system-ui;line-height:1.3">
          <div style="font-weight:700;margin-bottom:6px;">Interpolated Bike Availability</div>
          <div style="font-size:28px;font-weight:800;margin-bottom:4px;">${val.toFixed(0)}%</div>
          <div><b>Location:</b> ${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
          <div style="opacity:.7;margin-top:6px;">Computed via IDW (value-only)</div>
        </div>`
    });
    viewer.selectedEntity = bikesProbeEntity;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}


    async function loadBikes() {
      // clear is already called before loader, but safe to keep logic simple
      const url = "https://api.tfl.gov.uk/BikePoint";
      let data = [];
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`TfL API HTTP ${res.status}`);
        data = await res.json();
      } catch (e) {
        console.error("Failed to load TfL BikePoint:", e);
        alert("Could not fetch TfL BikePoint data. See console for details.");
        return;
      }

      const getCount = (props, key) => {
        const p = (props || []).find(x => x.key === key);
        const v = p && (p.value ?? p.val ?? p.defaultValue);
        const n = parseInt(String(v), 10);
        return isNaN(n) ? 0 : n;
      };

      const points = [];
      let west=  999, east=-999, south=  999, north=-999;

      data.forEach(bp => {
        const lat = parseFloat(bp.lat), lon = parseFloat(bp.lon);
        if (isNaN(lat) || isNaN(lon)) return;

        south = Math.min(south, lat); north = Math.max(north, lat);
        west  = Math.min(west,  lon); east  = Math.max(east,  lon);

        const props = bp.additionalProperties || [];
        const bikes = getCount(props, "NbBikes");
        const empty = getCount(props, "NbEmptyDocks");
        const docks = getCount(props, "NbDocks") || (bikes + empty);

        const ratio = docks > 0 ? (bikes / docks) : 0; // 0..1
        const pct = ratio * 100;

        let color = Cesium.Color.GRAY;
        if (ratio >= 0.66) color = Cesium.Color.fromCssColorString("#22c55e");
        else if (ratio >= 0.33) color = Cesium.Color.fromCssColorString("#eab308");
        else color = Cesium.Color.fromCssColorString("#ef4444");

        const name = bp.commonName || bp.id;
        viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: { pixelSize: 8, color, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
          label: {
            text: bikes.toString(),
            font: "bold 12px sans-serif",
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
            pixelOffset: new Cesium.Cartesian2(0, -16),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          description: `<b>${name}</b><br/><b>Available bikes:</b> ${bikes}<br/><b>Empty docks:</b> ${empty}<br/><b>Total docks:</b> ${docks}<br/><b>Availability:</b> ${(pct).toFixed(0)}%`
        });

        points.push({ lon, lat, value: pct });
      });

      // pad bbox slightly
      if (west < east && south < north){
        const padLon = (east - west) * 0.05, padLat = (north - south) * 0.05;
        west -= padLon; east += padLon; south -= padLat; north += padLat;

        const width=768,height=768,power=2;
        const url = renderIDWHeatmap(points, { west, east, south, north }, { width, height, power, stops: BIKES_STOPS });
        const rectangle = Cesium.Rectangle.fromDegrees(west, south, east, north);
        const provider  = new Cesium.SingleTileImageryProvider({ url, rectangle });
        bikesHeatmap = viewer.imageryLayers.addImageryProvider(provider);
        bikesHeatmap.alpha = 0.45;
        viewer.imageryLayers.raiseToTop(bikesHeatmap);

        window.BIKES_IDW = { points, bbox:{west,east,south,north}, power, width, height };
        enableBikeClickSampling();

      }

      console.log(`[BIKES] plotted ${data.length} BikePoints; IDW cells: 768×768`);
    }

    // ---------- DSM (Cesium ion) ----------
    const DSM_ASSET_ID = 3557552;
    const DSM_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzYTdmNGJjZS0yNzczLTQ2YzQtYTljOS03NmMwNzlkOWY4ZTAiLCJpZCI6MzE5NDk2LCJpYXQiOjE3NTE5NTk1Nzh9.SYVKEBbV-N8UeuAubHTDjLQtZEtznHNCkMSrPOctCLc";
    async function loadDSM() {
      try { if (Cesium.Ion && DSM_TOKEN) Cesium.Ion.defaultAccessToken = DSM_TOKEN; } catch {}
      try {
        if (Cesium.Terrain && typeof Cesium.Terrain.fromIonAssetId === "function") {
          viewer.terrain = await Cesium.Terrain.fromIonAssetId(DSM_ASSET_ID, { accessToken: DSM_TOKEN });
          await flyToLondonObliqueDSM(); return;
        } else if (Cesium.CesiumTerrainProvider && typeof Cesium.CesiumTerrainProvider.fromIonAssetId === "function") {
          const tp = await Cesium.CesiumTerrainProvider.fromIonAssetId(DSM_ASSET_ID, { accessToken: DSM_TOKEN });
          if (Cesium.Terrain?.fromProvider) viewer.terrain = Cesium.Terrain.fromProvider({ terrainProvider: tp });
          else viewer.terrainProvider = tp;
          await flyToLondon(); return;
        }
      } catch (e) { console.warn("[DSM] Terrain load failed, trying imagery...", e); }

      try {
        const imgProv = await Cesium.IonImageryProvider.fromAssetId(DSM_ASSET_ID, { accessToken: DSM_TOKEN });
        dsmLayer = viewer.imageryLayers.addImageryProvider(imgProv);
        viewer.imageryLayers.raiseToTop(dsmLayer);
        await flyToLondon(); return;
      } catch (e) { console.warn("[DSM] Imagery load failed, trying 3D Tiles...", e); }

      try {
        dsmTileset = await Cesium.Cesium3DTileset.fromIonAssetId(DSM_ASSET_ID, { accessToken: DSM_TOKEN });
        viewer.scene.primitives.add(dsmTileset);
        await viewer.zoomTo(dsmTileset);
        await flyToLondonObliqueDSM(); return;
      } catch (e) {
        console.error("[DSM] Could not load DSM.", e);
        alert("Could not load DSM asset from Cesium ion.");
      }
    }
    function flyToLondonObliqueDSM() {
      const lon=-0.1276, lat=51.5072;
      return viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 5000),
        orientation: { heading: Cesium.Math.toRadians(30), pitch: Cesium.Math.toRadians(-35), roll: 0.0 },
        duration: 1.6
      });
    }

    // ---------- Photorealistic & OSM ----------
    function flyToLondonObliqueCity() {
      const lon = -0.1696985, lat = 51.4843075;
      return viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 700),
        orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-35), roll: 0.0 },
        duration: 1.6
      });
    }
    async function loadPhotorealistic() {
      try {
        if (typeof Cesium.createGooglePhotorealistic3DTileset !== "function") throw new Error("createGooglePhotorealistic3DTileset not available");
        googleTileset = await Cesium.createGooglePhotorealistic3DTileset();
        viewer.scene.primitives.add(googleTileset);
        await flyToLondonObliqueCity();
        console.log("[PHOTO] Google Photorealistic 3D Tiles added.");
      } catch (e) { console.error("Photorealistic load failed:", e); alert("Could not load Google Photorealistic 3D Tiles."); }
    }
    async function loadOSM() {
      try {
        if (typeof Cesium.createOsmBuildingsAsync !== "function") throw new Error("createOsmBuildingsAsync not available");
        osmBuildings = await Cesium.createOsmBuildingsAsync();
        viewer.scene.primitives.add(osmBuildings);
        await flyToLondonObliqueCity();
        console.log("[OSM] OSM Buildings added.");
      } catch (e) { console.error("OSM Buildings load failed:", e); alert("Could not load OSM Buildings."); }
    }

    // ---------- Layer registry ----------
    const LAYERS = {
      async DSM() { await loadDSM(); },
      async BIKES() { await flyToLondon(); await loadBikes(); },
      async AQI()  { await flyToLondon(); await loadAQI();  },
      async TEMP() { await flyToLondon(); await loadTemperature(); },
      async PHOTOREALISTIC() { await loadPhotorealistic(); },
      async OSM() { await loadOSM(); },
    };

    startViewer();
