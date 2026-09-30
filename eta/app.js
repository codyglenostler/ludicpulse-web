(() => {
  'use strict';
  const sessionParameter = '_eta_session';
  const reloadedSession = !location.hash
    && new URLSearchParams(location.search).has(sessionParameter);
  let token = location.hash.slice(1);
  const validToken = /^[A-Za-z0-9_-]{40,80}$/.test(token);
  if (location.hash) {
    const search = new URLSearchParams(location.search);
    search.set(sessionParameter, crypto.randomUUID());
    history.replaceState(null, '', `${location.pathname}?${search}`);
  }
  const el = (id) => document.getElementById(id);
  let latest = null;
  let ended = false;
  let tickTimer = null;
  let stateWorker = null;
  let stateWorkerReady = false;
  let workerRetryTimer = null;
  let map = null;
  let mapScriptLoading = false;
  let mapKitInitialized = false;
  let currentMapToken = null;
  let mapItems = [];
  let estimatedRoute = null;
  let estimateBasis = null;
  let estimateGeneration = 0;
  let estimateFailures = 0;
  let estimateRetryTimer = null;
  let routeSourceLabel = null;

  const {
    validPoint, validPoints, presentation, requestAppleRoute, selectAppleRoute,
    shouldRefreshEstimate,
  } = window.EtaMapModel;
  const ESTIMATE_RETRY_MS = [5_000, 15_000, 60_000];
  // Match the API's telemetry freshness window, including while polls cannot finish.
  const LIVE_AFTER_MS = 60_000;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const clock = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const miles = (value) => `${value < 10 ? value.toFixed(1) : Math.round(value)} mi left`;
  function isDelayed(data) {
    const updatedAt = Date.parse(data?.updatedAt);
    return data?.state === 'delayed' || !Number.isFinite(updatedAt) || Date.now() - updatedAt > LIVE_AFTER_MS;
  }
  function terminal(state) {
    if (ended) return;
    ended = true;
    el('loading').hidden = true; el('trip').hidden = true; el('terminal').hidden = false;
    el('terminal-title').textContent = state === 'expired' ? 'Link expired'
      : state === 'reopen' || state === 'reconnect' ? 'Open the shared link again' : 'Sharing ended';
    el('terminal-body').textContent = state === 'expired' ? 'This four-hour private link has expired.'
      : state === 'reopen' ? 'For privacy, reloading clears this trip. Reopen the original link to continue.'
        : state === 'reconnect' ? 'The private connection was interrupted. Reopen the original link to reconnect.'
        : 'The driver arrived, stopped sharing, or changed destinations.';
    stopPolling();
    if (workerRetryTimer) clearTimeout(workerRetryTimer);
    workerRetryTimer = null;
    stateWorker?.terminate(); stateWorker = null; stateWorkerReady = false;
    latest = null; currentMapToken = null; estimatedRoute = null; token = null;
  }

  function svgRoute(points, progress, position) {
    const svg = el('route-fallback');
    if (!validPoints(points)) {
      svg.setAttribute('hidden', '');
      for (const id of ['route-background', 'route-line']) el(id).setAttribute('d', '');
      for (const id of ['start-marker', 'car-marker', 'destination-marker']) {
        el(id).removeAttribute('cx'); el(id).removeAttribute('cy');
      }
      return;
    }
    const latitudes = points.map((point) => point.latitude);
    const longitudes = points.map((point) => point.longitude);
    const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
    const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
    const latSpan = Math.max(0.00001, maxLat - minLat), lonSpan = Math.max(0.00001, maxLon - minLon);
    const scale = Math.min(580 / lonSpan, 320 / latSpan);
    const width = lonSpan * scale, height = latSpan * scale;
    const left = (700 - width) / 2, top = (420 - height) / 2;
    const project = (point) => ({
      x: left + (point.longitude - minLon) * scale,
      y: top + (maxLat - point.latitude) * scale,
    });
    const path = points.map((point, index) => {
      const p = project(point); return `${index ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }).join(' ');
    el('route-background').setAttribute('d', path);
    el('route-line').setAttribute('d', path);
    const start = project(points[0]);
    const destination = project(points.at(-1));
    const sharedEndpoint = start.x === destination.x && start.y === destination.y;
    el('start-marker').setAttribute('cx', start.x + (sharedEndpoint ? -10 : 0));
    el('start-marker').setAttribute('cy', start.y);
    const nearestIndex = validPoint(position) ? points.reduce((best, point, index) => {
      const lat = point.latitude - position.latitude;
      const lon = point.longitude - position.longitude;
      const distance = lat * lat + lon * lon;
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Infinity }).index : null;
    const routeIndex = nearestIndex ?? Math.round(
      clamp(progress, 0, 100) / 100 * (points.length - 1),
    );
    const current = project(points[routeIndex]);
    el('car-marker').setAttribute('cx', current.x); el('car-marker').setAttribute('cy', current.y);
    el('car-marker').setAttribute('visibility', routeIndex === 0 || routeIndex === points.length - 1 ? 'hidden' : 'visible');
    el('destination-marker').setAttribute('cx', destination.x + (sharedEndpoint ? 10 : 0));
    el('destination-marker').setAttribute('cy', destination.y);
    svg.removeAttribute('hidden');
  }

  function showMapFallback(data) {
    const hasRoute = validPoints(data?.routePoints);
    el('map').hidden = true;
    if (hasRoute) el('route-fallback').removeAttribute('hidden');
    else el('route-fallback').setAttribute('hidden', '');
    el('map-unavailable').hidden = hasRoute;
    el('route-source').hidden = true;
    el('route-legend').hidden = !hasRoute;
  }

  function routeLabel(value) {
    routeSourceLabel = value;
    el('route-source').hidden = !value;
    el('route-source').textContent = value ? `${isDelayed(latest) ? 'Last known · ' : ''}${value}` : '';
  }

  function drawMap(data) {
    svgRoute(data.routePoints, data.progress, data.position);
    el('map-unavailable').hidden = true;
    const model = presentation(data);
    if (!model.canRenderMap) { showMapFallback(data); return; }
    currentMapToken = data.mapToken;
    if (window.mapkit) { renderMapKit(data); return; }
    if (mapScriptLoading) return;
    mapScriptLoading = true;
    const script = document.createElement('script');
    script.src = 'https://cdn.apple-mapkit.com/mk/5.81.65/mapkit.js';
    script.onload = () => renderMapKit(latest);
    script.onerror = () => { mapScriptLoading = false; showMapFallback(latest); };
    document.head.append(script);
  }

  function renderMapKit(data) {
    try {
      const model = presentation(data);
      if (!window.mapkit || !currentMapToken || !model.hasPosition) return;
      if (!mapKitInitialized) {
        window.mapkit.addEventListener('error', () => {
          showMapFallback(latest);
        });
        window.mapkit.init({
          authorizationCallback: (done) => done(currentMapToken), language: 'en',
        });
        mapKitInitialized = true;
      }
      map ??= new window.mapkit.Map('map', {
        colorScheme: window.mapkit.Map.ColorSchemes.Dark,
        showsCompass: window.mapkit.FeatureVisibility.Hidden,
        showsMapTypeControl: false,
      });
      if (mapItems.length) map.removeItems(mapItems);
      const coordinate = (point) => new window.mapkit.Coordinate(point.latitude, point.longitude);
      const start = model.hasRoute ? data.routePoints[0] : data.position;
      const end = model.hasRoute ? data.routePoints.at(-1) : data.destination;
      const samePoint = (a, b) => validPoint(a) && validPoint(b)
        && a.latitude === b.latitude && a.longitude === b.longitude;
      const sharedEndpoint = samePoint(start, end);
      const endpoint = (point, kind, title) => new window.mapkit.Annotation(coordinate(point), () => {
        const dot = document.createElement('span');
        dot.className = `route-endpoint route-endpoint-${kind}`;
        dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', title);
        return dot;
      }, { title, accessibilityLabel: title, animates: false, displayPriority: 1000,
        anchorOffset: new DOMPoint(sharedEndpoint ? kind === 'start' ? -8 : 8 : 0, 6) });
      mapItems = [endpoint(start, 'start', 'Start')];
      if (!samePoint(start, data.position) && !samePoint(end, data.position)) {
        mapItems.push(new window.mapkit.MarkerAnnotation(coordinate(data.position), { color: '#378ADD', glyphText: '●',
          title: isDelayed(data) ? 'Last known location' : 'Current location' }));
      }
      if (model.hasRoute) {
        cancelEstimateWork(); estimatedRoute = null; estimateBasis = null; estimateFailures = 0;
        mapItems.unshift(new window.mapkit.PolylineOverlay(data.routePoints.map(coordinate), {
          style: new window.mapkit.Style({ strokeColor: '#378ADD', lineWidth: 5, lineJoin: 'round', lineCap: 'round' }),
        }));
        routeLabel('Tesla route');
      } else if (estimatedRoute?.polyline) {
        estimatedRoute.polyline.style = new window.mapkit.Style({
          strokeColor: '#378ADD', lineWidth: 5, lineJoin: 'round', lineCap: 'round',
        });
        mapItems.unshift(estimatedRoute.polyline);
        routeLabel('Estimated route');
      } else {
        routeLabel(null);
      }
      if (validPoint(end)) mapItems.push(endpoint(end, 'end', 'End'));
      map.addItems(mapItems); map.showItems(mapItems, { padding: new window.mapkit.Padding(48, 48, 48, 48) });
      el('map').hidden = false; el('route-fallback').setAttribute('hidden', ''); el('map-unavailable').hidden = true;
      el('route-legend').hidden = !validPoint(end);
      requestEstimatedRoute(data);
    } catch (error) {
      console.warn(`[Ludic Pulse] Map rendering failed (${typeof error?.name === 'string' ? error.name : 'Error'}).`);
      showMapFallback(data);
    }
  }

  function cancelEstimateWork() {
    estimateGeneration += 1;
    if (estimateRetryTimer) clearTimeout(estimateRetryTimer);
    estimateRetryTimer = null;
  }

  function scheduleEstimateRetry() {
    if (ended || document.hidden || estimateRetryTimer || !latest || isDelayed(latest) || validPoints(latest.routePoints)) return;
    const delay = ESTIMATE_RETRY_MS[Math.min(estimateFailures - 1, ESTIMATE_RETRY_MS.length - 1)];
    estimateRetryTimer = setTimeout(() => {
      estimateRetryTimer = null;
      void requestEstimatedRoute(latest, true);
    }, delay);
  }

  async function requestEstimatedRoute(data, force = false) {
    if (ended || document.hidden || isDelayed(data) || !window.mapkit || (!force && !shouldRefreshEstimate(estimateBasis, data))) return;
    if (estimateRetryTimer) clearTimeout(estimateRetryTimer);
    estimateRetryTimer = null;
    const requestGeneration = ++estimateGeneration;
    estimateBasis = { position: data.position, destination: data.destination, at: Date.now() };
    if (!estimatedRoute) routeLabel('Calculating route…');
    try {
      const response = await requestAppleRoute(window.mapkit, data.position, data.destination);
      if (requestGeneration !== estimateGeneration || !latest || validPoints(latest.routePoints)) return;
      const route = selectAppleRoute(response?.routes, data.remainingMiles);
      if (!route) throw new Error('MapKit returned no usable route');
      estimatedRoute = route;
      estimateFailures = 0;
      renderMapKit(latest);
    } catch (error) {
      if (requestGeneration !== estimateGeneration) return;
      estimateFailures += 1;
      if (!estimatedRoute) routeLabel('Route temporarily unavailable · retrying');
      const reason = typeof error?.name === 'string' ? error.name : 'Error';
      console.warn(`[Ludic Pulse] Estimated route request failed (${reason}).`);
      scheduleEstimateRetry();
    }
  }

  function render(data) {
    if (ended) return;
    if (Date.parse(data.expiresAt) <= Date.now()) { terminal('expired'); return; }
    latest = data; el('loading').hidden = true; el('terminal').hidden = true; el('trip').hidden = false;
    const delayed = isDelayed(data);
    el('state-chip').textContent = delayed ? 'Update delayed' : 'Live';
    el('state-chip').classList.toggle('delayed', delayed);
    el('heading').textContent = data.driverFirstName ? `${data.driverFirstName} is on the way` : 'On the way';
    el('destination').hidden = !data.destinationName;
    el('destination').textContent = data.destinationName ? `to ${data.destinationName}` : '';
    const etaAt = new Date(data.etaAt);
    el('arrival').textContent = Number.isFinite(etaAt.getTime()) ? clock(etaAt) : '—';
    el('miles').textContent = finite(data.remainingMiles) ? miles(Math.max(0, data.remainingMiles)) : 'Distance unavailable';
    el('battery').textContent = finite(data.arrivalSoc) ? `Arrival battery ${Math.round(data.arrivalSoc)}%` : 'Arrival battery unavailable';
    const progress = finite(data.progress) ? clamp(data.progress, 0, 100) : 0;
    el('progress').setAttribute('aria-valuenow', String(Math.round(progress)));
    el('progress').querySelector('span').style.width = `${progress}%`;
    drawMap(data); tick();
  }

  function tick() {
    if (ended || !latest) return;
    if (Date.parse(latest.expiresAt) <= Date.now()) { terminal('expired'); return; }
    const delayed = isDelayed(latest);
    el('state-chip').textContent = delayed ? 'Update delayed' : 'Live';
    el('state-chip').classList.toggle('delayed', delayed);
    el('map-wrap').setAttribute('aria-label', delayed ? 'Last known route map' : 'Live route map');
    el('map-unavailable').querySelector('span').textContent = delayed
      ? 'Waiting for a fresh trip update.' : 'Arrival and trip progress are still updating.';
    if (routeSourceLabel && !el('route-source').hidden) routeLabel(routeSourceLabel);
    if (delayed) {
      el('arrival').textContent = '—'; el('countdown').textContent = '—';
      el('miles').textContent = 'Distance update delayed';
      el('battery').textContent = 'Arrival battery update delayed';
      if (estimateBasis) {
        cancelEstimateWork(); estimateBasis = null;
        if (!estimatedRoute && !validPoints(latest.routePoints)) routeLabel(null);
      }
      return;
    }
    const eta = Date.parse(latest.etaAt);
    const minutes = Number.isFinite(eta) ? Math.max(0, Math.ceil((eta - Date.now()) / 60_000)) : null;
    el('countdown').textContent = minutes == null ? '—' : `${minutes} min`;
  }

  function showPollingError() {
    if (ended) return;
    if (latest) {
      latest.state = 'delayed'; render(latest);
    } else {
      el('loading').querySelector('p').textContent = 'The latest update is delayed. Retrying…';
    }
  }

  function handleStateMessage(event) {
    if (ended) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'error') { showPollingError(); return; }
    if (message.type === 'invalid') { terminal('ended'); return; }
    if (message.type === 'ready') {
      stateWorkerReady = true;
      token = null;
      if (!document.hidden) startPolling();
      return;
    }
    if (message.type !== 'state') return;
    const responseData = message.data;
    if (!responseData || typeof responseData !== 'object') { showPollingError(); return; }
    const destinationCleared = responseData.destination === null;
    const routeCleared = destinationCleared || responseData.routeVersion === ''
      || (Array.isArray(responseData.routePoints) && responseData.routePoints.length === 0);
    const versionChanged = Object.prototype.hasOwnProperty.call(responseData, 'routeVersion')
      && responseData.routeVersion !== latest?.routeVersion;
    if (destinationCleared) {
      cancelEstimateWork(); estimatedRoute = null; estimateBasis = null; estimateFailures = 0;
    }
    const data = responseData.state === 'active' || responseData.state === 'delayed'
      ? { ...latest, ...responseData,
        ...(destinationCleared ? { destination: null, destinationName: null } : {}),
        // Omission can reuse only the same cached route. Empty points/version are
        // authoritative invalidation, including privacy redaction of a destination.
        routePoints: routeCleared ? [] : responseData.routePoints ?? (versionChanged ? [] : latest?.routePoints),
        routeVersion: routeCleared || (versionChanged && responseData.routePoints == null)
          ? undefined : responseData.routeVersion ?? latest?.routeVersion,
      }
      : responseData;
    if (data.state === 'ended' || data.state === 'expired') terminal(data.state);
    else if (data.state === 'active' || data.state === 'delayed') render(data);
    else showPollingError();
  }

  function startPolling() {
    if (ended || document.hidden || !stateWorkerReady) return;
    tick();
    if (ended) return;
    stateWorker?.postMessage({ type: 'start' });
    tickTimer ??= setInterval(tick, 1_000);
  }
  function stopPolling() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null; stateWorker?.postMessage({ type: 'stop' });
    cancelEstimateWork(); estimateBasis = null;
  }

  function retryWorker() {
    if (ended) return;
    stateWorker?.terminate();
    stateWorker = null; stateWorkerReady = false;
    if (!token || workerRetryTimer) return;
    showPollingError();
    workerRetryTimer = setTimeout(() => {
      workerRetryTimer = null;
      initializePolling();
    }, 5_000);
  }

  function handleWorkerError() {
    if (ended) return;
    if (token) retryWorker();
    else terminal('reconnect');
  }

  function initializePolling() {
    if (ended) return;
    try {
      stateWorker = new Worker('/eta/state-worker.js?v=20260830-token-isolation', {
        name: 'ludic-eta-state',
      });
    } catch {
      retryWorker();
      return;
    }
    stateWorker.addEventListener('message', handleStateMessage);
    stateWorker.addEventListener('error', handleWorkerError);
    stateWorker.postMessage({ type: 'initialize', token });
  }

  document.addEventListener('visibilitychange', () => document.hidden ? stopPolling() : startPolling());
  if (!validToken) { token = null; terminal(reloadedSession ? 'reopen' : 'ended'); }
  else initializePolling();
})();
