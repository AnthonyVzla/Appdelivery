import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ibclzcikkxhdnorcbfoe.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImliY2x6Y2lra3hoZG5vcmNiZm9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NTUwNTEsImV4cCI6MjEwODAzMTA1MX0.FU_CgXhXloA4le2KfBRc0bCIXjewuJ8zr7JxUJLcKJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");
const roleNames = { motorizado: "Motorizado", soporte: "Soporte", administracion: "Administración", aliado: "Aliado" };
const statusNames = { pending: "Disponible", assigned: "Asignado", at_store: "En el comercio", in_transit: "En camino", delivered: "Entregado" };
const state = { session: null, profile: null, screen: "inicio", orders: [], allies: [], profiles: [], courierLocations: [], period: "day", authMode: "login", toastTimer: null, refreshTimer: null, updateCheckTimer: null, locationRefreshTimer: null, overdueTimer: null, realtime: null, serviceWorkerRegistration: null, updatePending: false, reloadingForUpdate: false, alertsEnabled: false, overdueSoundsEnabled: false, alertAudio: {}, courierLocationWatchId: null, nativeBackgroundLocationWatcherId: null, courierLocationWritePending: false, lastCourierLocationSentAt: 0, latestCourierPosition: null, courierWakeLock: null, courierLocationError: "", monitoringLocationLoadError: false, leafletPromise: null, monitoringMap: null, monitoringMarkers: null, monitoringMapContainer: null, monitoringMapDidFit: false, notifiedOrders: new Set(), overdueAlarmTimes: new Map() };

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function legalFooter() {
  return `<footer class="legal-footer">Derechos reservados · A un paso RIF: J-503180226 <span>POWERED BY BAMBAMDEV</span></footer>`;
}

function renderAudioActivationPrompt() {
  if (state.profile.role === "motorizado" && !state.alertsEnabled) {
    return `<aside class="audio-activation" role="status"><div><strong>Activa las alertas de pedidos</strong><p>Permite el sonido de pedidos entrantes y asignados en este dispositivo.</p></div><button class="button primary" data-action="alerts">Activar alertas</button></aside>`;
  }
  if (["soporte", "administracion"].includes(state.profile.role) && !state.overdueSoundsEnabled) {
    return `<aside class="audio-activation" role="status"><div><strong>Activa la alarma de retrasos</strong><p>Habilita el sonido para pedidos que superen los 10 minutos sin llegar al comercio.</p></div><button class="button primary" data-action="overdue-sound">Activar alarma</button></aside>`;
  }
  return "";
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function dateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function showToast(message, isError = false) {
  toastNode.textContent = message;
  toastNode.classList.toggle("error-toast", isError);
  toastNode.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastNode.classList.add("hidden"), 4200);
}

function reportError(error) {
  console.error(error);
  showToast(error.message || "Ocurrió un error. Intenta nuevamente.", true);
}

function usernameEmail(username) {
  return `${username.trim().toLowerCase()}@users.aunpaso.local`;
}

async function boot() {
  setupServiceWorkerUpdates();
  const { data, error } = await supabase.auth.getSession();
  if (error) return reportError(error);
  if (data.session) {
    state.session = data.session;
    await loadProfile();
  } else {
    renderAuth();
  }
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      clearInterval(state.refreshTimer);
      stopCourierLocationTracking();
      state.session = null;
      state.profile = null;
      renderAuth();
    }
  });
}

function setupServiceWorkerUpdates() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (state.reloadingForUpdate) return;
    if (state.screen === "crear" && hasUnsavedFormData()) {
      state.updatePending = true;
      showToast("Nueva versión lista. Se actualizará al terminar o salir del formulario.");
      return;
    }
    reloadForServiceWorkerUpdate();
  });

  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((registration) => {
    state.serviceWorkerRegistration = registration;
    return registration.update();
  }).catch((error) => console.error("No se pudo registrar o comprobar el service worker:", error));

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkServiceWorkerUpdate();
      resumeCourierLocationTracking();
    }
  });
  window.addEventListener("pageshow", resumeCourierLocationTracking);
  window.addEventListener("focus", resumeCourierLocationTracking);
  state.updateCheckTimer = setInterval(checkServiceWorkerUpdate, 30 * 60 * 1000);
}

function checkServiceWorkerUpdate() {
  if (!state.serviceWorkerRegistration) return;
  state.serviceWorkerRegistration.update().catch((error) => {
    console.error("No se pudo comprobar si hay una versión nueva:", error);
  });
}

function hasUnsavedFormData() {
  return [...app.querySelectorAll("form input, form textarea, form select")]
    .some((field) => field.value.trim() !== "");
}

function reloadForServiceWorkerUpdate() {
  state.reloadingForUpdate = true;
  location.reload();
}

function applyPendingServiceWorkerUpdate() {
  if (state.updatePending) reloadForServiceWorkerUpdate();
}

async function loadProfile() {
  stopCourierLocationTracking();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle();
  if (error) return reportError(error);
  if (!data) {
    showToast("No se encontró el perfil. Contacta a administración.", true);
    await supabase.auth.signOut();
    return;
  }
  state.profile = data;
  state.courierLocations = [];
  state.monitoringLocationLoadError = false;
  state.notifiedOrders.clear();
  state.alertsEnabled = false;
  if (!data.approved || !data.role || data.suspended) {
    renderPending();
    return;
  }
  if (data.role === "motorizado" && data.online) {
    const { error: heartbeatError } = await supabase.rpc("heartbeat_courier");
    if (heartbeatError) console.error("No se pudo actualizar la actividad del motorizado:", heartbeatError);
  }
  await refreshData(false);
  renderApp();
  if (state.profile.role === "motorizado" && state.profile.online) startCourierLocationTracking();
  startRealtime();
  clearInterval(state.refreshTimer);
  clearInterval(state.overdueTimer);
  if (["soporte", "administracion"].includes(state.profile.role)) {
    state.overdueTimer = setInterval(updateOverdueClocks, 1000);
  }
  state.refreshTimer = setInterval(async () => {
    if (state.profile.role === "motorizado" && state.profile.online) {
      const { error: heartbeatError } = await supabase.rpc("heartbeat_courier");
      if (heartbeatError) console.error("No se pudo actualizar la actividad del motorizado:", heartbeatError);
    }
    await refreshData(true);
    renderIfSafe();
  }, state.profile.role === "motorizado" ? 5000 : 18000);
}

function renderIfSafe() {
  if (state.screen === "crear") return;
  if (state.screen === "monitoreo") {
    refreshMonitoringView();
    return;
  }
  if (app.querySelector("input:focus, textarea:focus, select:focus")) return;
  if (!hasUnsavedFormData()) renderApp();
}

function startRealtime() {
  if (state.realtime) supabase.removeChannel(state.realtime);
  const channel = supabase.channel(`updates-${state.profile.id}`);
  if (state.profile.role === "motorizado") {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async (payload) => {
      const locallyOwnedOrder = payload.new
        ? state.orders.find((order) => order.id === payload.new.id && order.courier_id === state.profile.id)
        : null;
      if (payload.eventType === "UPDATE" && locallyOwnedOrder && payload.new?.courier_id !== state.profile.id) {
        state.orders = state.orders.filter((order) => order.id !== payload.new.id);
        renderIfSafe();
      }
      const assignedOrder = payload.new && payload.new.courier_id === state.profile.id
        ? { ...payload.new, allies: state.allies.find((ally) => ally.id === payload.new.ally_id) }
        : null;
      await refreshData(true);
      if (assignedOrder && payload.eventType === "UPDATE") {
        emitCourierNotification("assigned", assignedOrder);
      }
      renderIfSafe();
    });
  } else {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async () => {
      await refreshData(true);
      renderIfSafe();
    }).on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, async () => {
      await refreshData(true);
      renderIfSafe();
    });
    if (["soporte", "administracion"].includes(state.profile.role)) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "courier_locations" }, async () => {
        await refreshCourierLocations();
        renderIfSafe();
      });
    }
  }

  state.realtime = channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.error(`Supabase Realtime: ${status}`);
  });
}

async function requestCourierWakeLock() {
  if (!("wakeLock" in navigator) || document.hidden) return;
  try {
    if (!state.courierWakeLock || state.courierWakeLock.released) {
      state.courierWakeLock = await navigator.wakeLock.request("screen");
      state.courierWakeLock.addEventListener("release", () => {
        state.courierWakeLock = null;
      }, { once: true });
    }
  } catch (error) {
    console.warn("No se pudo mantener activa la pantalla para el GPS:", error);
  }
}

function nativeBackgroundLocation() {
  return window.Capacitor?.Plugins?.BackgroundGeolocation || null;
}

function stopCourierLocationTracking() {
  const nativeLocation = nativeBackgroundLocation();
  if (state.nativeBackgroundLocationWatcherId !== null && nativeLocation) {
    nativeLocation.removeWatcher({ id: state.nativeBackgroundLocationWatcherId }).catch(() => {});
  }
  state.nativeBackgroundLocationWatcherId = null;
  if (state.courierLocationWatchId !== null && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(state.courierLocationWatchId);
  }
  if (state.locationRefreshTimer) clearInterval(state.locationRefreshTimer);
  if (state.courierWakeLock) {
    state.courierWakeLock.release().catch(() => {});
    state.courierWakeLock = null;
  }
  state.courierLocationWatchId = null;
  state.locationRefreshTimer = null;
  state.courierLocationWritePending = false;
  state.lastCourierLocationSentAt = 0;
  state.latestCourierPosition = null;
}

async function sendCourierLocation(position, force = false) {
  if (!state.profile?.online || (!force && (state.courierLocationWritePending || Date.now() - state.lastCourierLocationSentAt < 15000))) return;
  state.courierLocationWritePending = true;
  try {
    await supabase.rpc("heartbeat_courier");
    const { error } = await supabase.rpc("update_courier_location", {
      p_latitude: position.coords.latitude,
      p_longitude: position.coords.longitude,
      p_accuracy: position.coords.accuracy
    });
    if (error) throw error;
    state.lastCourierLocationSentAt = Date.now();
    state.courierLocationError = "";
  } catch (error) {
    console.error("No se pudo guardar la ubicación del motorizado:", error);
    state.courierLocationError = "No se pudo actualizar tu ubicación. Verifica tu conexión y los permisos del GPS.";
    showToast(state.courierLocationError, true);
  } finally {
    state.courierLocationWritePending = false;
  }
}

function requestCurrentCourierLocation(force = false) {
  if (!state.profile?.online || !("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition((position) => {
    state.latestCourierPosition = position;
    sendCourierLocation(position, force);
  }, (error) => {
    console.error("No se pudo consultar la ubicación actual:", error);
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
}

function resumeCourierLocationTracking() {
  if (state.profile?.role === "motorizado" && state.profile.online) {
    if (state.courierLocationWatchId === null && "geolocation" in navigator) startCourierLocationTracking();
    else requestCurrentCourierLocation(true);
    requestCourierWakeLock();
  }
}

async function startNativeBackgroundLocationTracking() {
  const nativeLocation = nativeBackgroundLocation();
  if (!nativeLocation || state.nativeBackgroundLocationWatcherId !== null) return false;
  state.courierLocationError = "";
  try {
    state.nativeBackgroundLocationWatcherId = await nativeLocation.addWatcher({
      backgroundMessage: "Ubicación activa para entregas. Cambia a OFF para detenerla.",
      backgroundTitle: "A un paso · GPS activo",
      requestPermissions: true,
      stale: false,
      distanceFilter: 10
    }, (location, error) => {
      if (error) {
        console.error("GPS nativo:", error);
        if (error.code === "NOT_AUTHORIZED") {
          state.courierLocationError = "Concede ubicación permanente y ubicación en segundo plano para compartir tu posición.";
          showToast(state.courierLocationError, true);
        }
        return;
      }
      const position = { coords: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy } };
      state.latestCourierPosition = position;
      sendCourierLocation(position);
    });
    return true;
  } catch (error) {
    console.error("No se pudo iniciar el GPS nativo:", error);
    return false;
  }
}

function startCourierLocationTracking() {
  if (nativeBackgroundLocation()) {
    startNativeBackgroundLocationTracking();
    return;
  }
  if (state.profile?.role !== "motorizado" || !state.profile.online || !("geolocation" in navigator)) {
    if (state.profile?.role === "motorizado" && state.profile.online && !("geolocation" in navigator)) {
      state.courierLocationError = "Este navegador no permite compartir la ubicación.";
      showToast(state.courierLocationError, true);
    }
    return;
  }
  if (state.courierLocationWatchId !== null) return;
  state.courierLocationError = "";
  requestCourierWakeLock();
  state.courierLocationWatchId = navigator.geolocation.watchPosition((position) => {
    state.latestCourierPosition = position;
    sendCourierLocation(position);
  }, (error) => {
    state.courierLocationError = error.code === error.PERMISSION_DENIED
      ? "Permiso de ubicación denegado. Actívalo en los ajustes del navegador para aparecer en Monitoreo."
      : "No se pudo obtener la ubicación. Comprueba el GPS del teléfono e inténtalo de nuevo.";
    showToast(state.courierLocationError, true);
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  state.locationRefreshTimer = setInterval(() => requestCurrentCourierLocation(), 15000);
  requestCurrentCourierLocation(true);
}

function renderAuth() {
  const isRegister = state.authMode === "register";
  app.innerHTML = `
    <div class="auth-page"><section class="auth-shell"><div class="auth-card">
      <img class="brand-logo" src="./images (1).png" alt="A un paso delivery">
      <p class="eyebrow">GESTIÓN DE ENTREGAS</p>
      <h1>${isRegister ? "Crea tu cuenta" : "Bienvenido"}</h1>
      <p class="muted">${isRegister ? "Regístrate y espera la aprobación de administración." : "Ingresa a tu cuenta para continuar."}</p>
      <form id="auth-form" class="stack">
        ${isRegister ? `<div class="stack"><label>Nombre<input name="firstName" autocomplete="given-name" required></label><label>Apellido<input name="lastName" autocomplete="family-name" required></label><label>Teléfono<input name="phone" type="tel" autocomplete="tel" required></label></div>` : ""}
        <label>Usuario<input name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_.-]{3,32}" title="Usa de 3 a 32 letras, números, punto, guion o guion bajo." autocapitalize="none"></label>
        <label>Contraseña<input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" required minlength="6"></label>
        <p id="auth-error" class="error hidden" role="alert"></p>
        <button class="button primary full" id="auth-submit">${isRegister ? "Crear cuenta" : "Iniciar sesión"}</button>
      </form>
      <button class="text-button" id="auth-toggle">${isRegister ? "¿Ya tienes cuenta? Iniciar sesión" : "¿No tienes cuenta? Crear cuenta"}</button>
      <p class="fine-print">El acceso a cuentas nuevas requiere aprobación de administración.</p>
    </div></section>${legalFooter()}</div>`;
  document.querySelector("#auth-toggle").addEventListener("click", () => {
    state.authMode = isRegister ? "login" : "register";
    renderAuth();
  });
  document.querySelector("#auth-form").addEventListener("submit", submitAuth);
}

async function submitAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get("username")).trim();
  const password = String(form.get("password"));
  const button = document.querySelector("#auth-submit");
  const errorNode = document.querySelector("#auth-error");
  button.disabled = true;
  button.textContent = "Procesando…";
  errorNode.classList.add("hidden");
  try {
    if (state.authMode === "register") {
      const { data, error } = await supabase.auth.signUp({
        email: usernameEmail(username),
        password,
        options: { data: { username: username.toLowerCase(), first_name: String(form.get("firstName")).trim(), last_name: String(form.get("lastName")).trim(), phone: String(form.get("phone")).trim() } }
      });
      if (error) throw error;
      if (!data.session) {
        errorNode.textContent = "La cuenta se creó. En Supabase, desactiva la confirmación por correo para permitir el acceso con usuario y contraseña (no se solicita correo).";
        errorNode.classList.remove("hidden");
      } else {
        showToast("Cuenta creada. Espera la aprobación de administración.");
        state.session = data.session;
        await loadProfile();
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
      if (error) throw new Error("Usuario o contraseña incorrectos.");
      state.session = data.session;
      await loadProfile();
    }
  } catch (error) {
    errorNode.textContent = error.message || "No se pudo completar el acceso.";
    errorNode.classList.remove("hidden");
  } finally {
    if (document.querySelector("#auth-submit")) {
      button.disabled = false;
      button.textContent = state.authMode === "register" ? "Crear cuenta" : "Iniciar sesión";
    }
  }
}

function renderPending() {
  const suspended = state.profile?.suspended;
  app.innerHTML = `<div class="auth-page"><section class="auth-shell"><div class="auth-card">
    <img class="brand-logo" src="./images (1).png" alt="A un paso delivery">
    <p class="eyebrow">A UN PASO DELIVERY</p><h1>${suspended ? "Cuenta suspendida" : "Solicitud recibida"}</h1>
    <p class="muted">${suspended ? "Tu acceso está suspendido. Comunícate con administración." : "Tu cuenta aún no está habilitada. Podrás ingresar cuando administración apruebe tu usuario y asigne un rol."}</p>
    <button class="button subtle full" id="logout-button">Cerrar sesión</button>
  </div></section>${legalFooter()}</div>`;
  document.querySelector("#logout-button").addEventListener("click", signOut);
}

async function refreshData(quiet) {
  if (!state.profile || !state.session) return;
  const { data: orders, error: orderError } = await supabase.from("orders")
    .select("*, allies(name, location_url), courier:profiles!orders_courier_id_fkey(full_name, username, phone), creator:profiles!orders_created_by_fkey(full_name)")
    .order("created_at", { ascending: false }).limit(500);
  if (orderError) {
    if (!quiet) reportError(orderError);
    return;
  }
  const previousOrders = new Map(state.orders.map((order) => [order.id, order]));
  state.orders = orders || [];
  if (quiet && state.profile.role === "motorizado") {
    for (const order of state.orders) {
      const previous = previousOrders.get(order.id);
      if (order.courier_id === state.profile.id && order.status !== "delivered" && previous?.courier_id !== state.profile.id) {
        emitCourierNotification("assigned", order);
      } else if (!previous && order.status === "pending" && order.released && state.profile.online) {
        emitCourierNotification("incoming", order);
      }
    }
  }
  if (["administracion", "soporte", "aliado"].includes(state.profile.role)) {
    const [allyResult, profileResult] = await Promise.all([
      supabase.from("allies").select("*").order("name"),
      supabase.from("profiles").select("id, username, full_name, phone, role, ally_id, approved, suspended, online, last_seen_at, updated_at").order("full_name")
    ]);
    if (allyResult.error || profileResult.error) {
      if (!quiet) reportError(allyResult.error || profileResult.error);
      return;
    }
    state.allies = allyResult.data || [];
    state.profiles = profileResult.data || [];
    if (["soporte", "administracion"].includes(state.profile.role)) await refreshCourierLocations(quiet);
    refreshActiveCourierOptions();
  }
}

async function refreshCourierLocations(quiet = true) {
  if (!["soporte", "administracion"].includes(state.profile?.role)) return;
  const freshAfter = new Date(Date.now() - 90000).toISOString();
  const { data, error } = await supabase.from("courier_locations")
    .select("courier_id, latitude, longitude, accuracy, updated_at")
    .gt("updated_at", freshAfter);
  if (error) {
    const wasUnavailable = state.monitoringLocationLoadError;
    state.monitoringLocationLoadError = true;
    if (!quiet) reportError(error);
    else if (!wasUnavailable) console.error("No se pudieron cargar las ubicaciones de motorizados:", error);
    return;
  }
  state.monitoringLocationLoadError = false;
  state.courierLocations = data || [];
}

function activeCouriers() {
  const activeAfter = Date.now() - 90000;
  return state.profiles.filter((profile) =>
    profile.role === "motorizado"
    && profile.approved
    && !profile.suspended
    && profile.online
    && profile.last_seen_at
    && new Date(profile.last_seen_at).getTime() > activeAfter
  );
}

function refreshActiveCourierOptions() {
  const select = document.querySelector("#assigned-courier");
  if (!select) return;
  const selectedId = select.value;
  const couriers = activeCouriers();
  const selectedIsActive = couriers.some((profile) => profile.id === selectedId);
  const staleSelection = selectedId && !selectedIsActive
    ? state.profiles.find((profile) => profile.id === selectedId)
    : null;
  select.innerHTML = `<option value="">Ninguno — pedido visible para motorizados activos</option>${staleSelection
    ? `<option value="${staleSelection.id}">⚠ ${escapeHtml(staleSelection.full_name)} ya no está activo</option>`
    : ""}${couriers.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name)} (@${escapeHtml(profile.username)})</option>`).join("")}`;
  if (selectedId) select.value = selectedId;
}

const navItems = {
  motorizado: [["inicio", "Resumen"], ["activos", "Pedidos activos"], ["curso", "Pedido en curso"], ["entregados", "Entregados"]],
  soporte: [["inicio", "Resumen"], ["crear", "Crear pedido"], ["pendientes", "Pedidos pendientes"], ["pedidos", "Pedidos"], ["entregados", "Finalizados"], ["motorizados", "Motorizados activos"], ["monitoreo", "Monitoreo"], ["aliados", "Aliados"]],
  administracion: [["inicio", "Resumen"], ["pendientes", "Pedidos pendientes"], ["pedidos", "Pedidos"], ["entregados", "Finalizados"], ["motorizados", "Motorizados activos"], ["monitoreo", "Monitoreo"], ["usuarios", "Usuarios"], ["aliados", "Aliados"], ["reportes", "Reportes"], ["metricas", "Métricas"]],
  aliado: [["crear", "Crear pedido"], ["mis_pedidos", "Pedidos en curso"], ["historial", "Historial"]]
};

function renderApp() {
  if (!state.profile?.role) return renderPending();
  const items = navItems[state.profile.role] || [];
  if (!items.some(([key]) => key === state.screen)) state.screen = items[0]?.[0] || "inicio";
  const nav = items.map(([key, label]) => `<button class="nav-button ${state.screen === key ? "active" : ""}" data-screen="${key}">${label}</button>`).join("");
  app.innerHTML = `<div class="app-page"><div class="layout">
    <aside class="sidebar">
      <div class="sidebar-brand"><img src="./images (1).png" alt=""><div><strong>A un paso<br>delivery</strong><span>${roleNames[state.profile.role]}</span></div></div>
      <nav class="nav-list">${nav}</nav>
      <div class="sidebar-bottom"><div class="user-summary"><strong>${escapeHtml(state.profile.full_name)}</strong><span>@${escapeHtml(state.profile.username)} · ${roleNames[state.profile.role]}</span></div><button class="button subtle full" data-action="logout">Cerrar sesión</button></div>
    </aside>
    <main class="main">
      <header class="topbar"><div><div class="mobile-brand"><img src="./images (1).png" alt=""><strong>A un paso delivery</strong></div><h1>${escapeHtml(titleFor(state.screen))}</h1><p>${new Intl.DateTimeFormat("es-CO", { dateStyle: "full" }).format(new Date())}</p></div>
        ${state.profile.role === "motorizado" ? `<div class="header-actions"><button class="button subtle small" data-action="alerts" aria-pressed="${state.alertsEnabled}">${state.alertsEnabled ? "Desactivar alertas" : "Activar alertas"}</button><label class="switch-row"><span class="muted">${state.profile.online ? "Activo" : "Desconectado"}</span><span class="switch"><input type="checkbox" data-action="online" ${state.profile.online ? "checked" : ""} aria-label="Disponibilidad"><span></span></span></label><button class="button subtle small mobile-logout" data-action="logout">Cerrar sesión</button></div>` : `<div class="header-actions">${["soporte", "administracion"].includes(state.profile.role) ? `<button class="button subtle small" data-action="overdue-sound" aria-pressed="${state.overdueSoundsEnabled}">${state.overdueSoundsEnabled ? "Alarma activada" : "Activar alarma"}</button><span class="badge green">${countOnline()} motorizados activos</span>` : ""}${["soporte", "administracion", "aliado"].includes(state.profile.role) ? `<button class="button subtle small mobile-logout" data-action="logout">Cerrar sesión</button>` : ""}</div>`}
      </header>
      ${renderAudioActivationPrompt()}
      <section id="screen-content">${renderScreen()}</section>
    </main>
    <nav class="mobile-nav">${nav}</nav>
  </div>${legalFooter()}</div>`;
  app.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => {
    if (state.screen === "monitoreo" && button.dataset.screen !== "monitoreo" && state.monitoringMap) {
      state.monitoringMap.remove();
      state.monitoringMap = null;
      state.monitoringMarkers = null;
      state.monitoringMapContainer = null;
      state.monitoringMapDidFit = false;
    }
    state.screen = button.dataset.screen;
    renderApp();
    applyPendingServiceWorkerUpdate();
  }));
  app.querySelectorAll('[data-action="logout"]').forEach((button) => button.addEventListener("click", signOut));
  const onlineToggle = app.querySelector('[data-action="online"]');
  if (onlineToggle) onlineToggle.addEventListener("change", toggleOnline);
  const alertsButton = app.querySelector('[data-action="alerts"]');
  if (alertsButton) alertsButton.addEventListener("click", toggleCourierAlerts);
  const overdueSoundButton = app.querySelector('[data-action="overdue-sound"]');
  if (overdueSoundButton) overdueSoundButton.addEventListener("click", enableOverdueSounds);
  const activationButton = app.querySelector(".audio-activation [data-action]");
  if (activationButton) {
    activationButton.addEventListener("click", activationButton.dataset.action === "alerts" ? toggleCourierAlerts : enableOverdueSounds);
  }
  bindScreenActions();
  if (state.screen === "monitoreo") void initializeMonitoringMap();
}

async function toggleCourierAlerts() {
  if (state.alertsEnabled) {
    state.alertsEnabled = false;
    showToast("Alertas de sonido y vibración desactivadas.");
    renderApp();
    return;
  }

  try {
    await prepareAlertAudio("incoming");
    state.alertsEnabled = true;
    showToast("Sonido de pedidos probado y alertas activadas para esta sesión.");
    renderApp();
  } catch (error) {
    reportError(new Error(`No se pudieron activar las alertas: ${error.message}`));
  }
}

function alertAudioFor(kind) {
  const source = kind === "overdue"
    ? "./classic-danger-alarm.mp3"
    : "./email-notification-message-ring.wav";
  if (!state.alertAudio[kind]) {
    const audio = new Audio(source);
    audio.preload = "auto";
    audio.volume = 1;
    state.alertAudio[kind] = audio;
  }
  return state.alertAudio[kind];
}

async function prepareAlertAudio(kind) {
  const audio = alertAudioFor(kind);
  audio.currentTime = 0;
  await audio.play();
}

async function playAlertAudio(kind) {
  const audio = alertAudioFor(kind);
  try {
    audio.pause();
    audio.currentTime = 0;
    await audio.play();
  } catch (error) {
    console.error(`No se pudo reproducir el audio ${kind}:`, error);
    showToast("El navegador bloqueó el sonido. Pulsa Activar alertas o Activar alarma para habilitar el audio.", true);
  }
}

async function playCourierAlert(kind) {
  if (!state.alertsEnabled) return;
  await playAlertAudio("incoming");
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(kind === "assigned" ? [350, 120, 350, 120, 500] : [180, 90, 180]);
  }
}

async function notifyCourier(kind, order) {
  const allyName = order.allies?.name || "Aliado";
  const message = kind === "assigned"
    ? `Tienes un pedido asignado de ${allyName}.`
    : `Nuevo pedido disponible de ${allyName}.`;
  showToast(message);
  if (!state.alertsEnabled) return;
  await playCourierAlert(kind);
}

function emitCourierNotification(kind, order) {
  const key = `${order.id}:${kind}`;
  if (state.notifiedOrders.has(key)) return;
  state.notifiedOrders.add(key);
  if (state.notifiedOrders.size > 500) {
    state.notifiedOrders.delete(state.notifiedOrders.values().next().value);
  }
  void notifyCourier(kind, order);
}

function titleFor(screen) {
  return ({ inicio: "Resumen", activos: "Pedidos activos", curso: "Pedido en curso", entregados: "Pedidos entregados", crear: "Crear pedido", pedidos: "Pedidos", pendientes: "Pedidos pendientes", mis_pedidos: "Pedidos en curso", historial: "Historial", motorizados: "Motorizados activos", monitoreo: "Monitoreo", aliados: "Aliados", usuarios: "Usuarios", reportes: "Reportes", metricas: "Métricas" })[screen] || "A un paso delivery";
}

function countOnline() {
  const activeAfter = Date.now() - 90000;
  return state.profiles.filter((profile) => profile.role === "motorizado" && profile.approved && !profile.suspended && profile.online && profile.last_seen_at && new Date(profile.last_seen_at).getTime() > activeAfter).length;
}

function dayStart(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function renderScreen() {
  const role = state.profile.role;
  if (role === "aliado") {
    if (state.screen === "crear") return renderCreateOrder();
    if (state.screen === "mis_pedidos") return renderAllyOrders(false);
    if (state.screen === "historial") return renderAllyOrders(true);
  }
  if (state.screen === "inicio") return renderDashboard();
  if (state.screen === "crear" && ["soporte", "administracion"].includes(role)) return renderCreateOrder();
  if (state.screen === "pendientes" && ["soporte", "administracion"].includes(role)) return renderPendingOrders();
  if (state.screen === "activos" && role === "motorizado") return renderCourierAvailable();
  if (state.screen === "curso" && role === "motorizado") return renderCourierCurrent();
  if (state.screen === "motorizados" && ["soporte", "administracion"].includes(role)) return renderActiveCouriers();
  if (state.screen === "monitoreo" && ["soporte", "administracion"].includes(role)) return renderMonitoring();
  if (state.screen === "pedidos" && role !== "motorizado") return renderStaffOrders();
  if (state.screen === "entregados") return role === "motorizado" ? renderCourierDelivered() : renderCompletedOrders();
  if (state.screen === "aliados" && role !== "motorizado") return renderAllies();
  if (state.screen === "usuarios" && role === "administracion") return renderUsers();
  if (state.screen === "reportes" && role === "administracion") return renderReports();
  if (state.screen === "metricas" && role === "administracion") return renderMetrics();
  return `<div class="empty">Selecciona una sección.</div>`;
}

function renderPendingOrders() {
  const orders = state.orders.filter((order) => order.status === "pending" && !order.courier_id);
  return `<p class="muted">Pedidos creados por aliados y pedidos aún sin motorizado. Asígnalos o libéralos para que los motorizados activos puedan tomarlos.</p><div class="list">${renderOrderCards(orders, "pending")}</div>`;
}

function renderAllyOrders(history) {
  const orders = state.orders.filter((order) => history ? order.status === "delivered" : order.status !== "delivered");
  return `<p class="muted">${history ? "Pedidos entregados de tu aliado." : "Pedidos en espera de soporte, asignados o en curso."}</p><div class="list">${renderOrderCards(orders, history ? "completed" : "ally")}</div>`;
}

function renderActiveCouriers() {
  const couriers = activeCouriers();
  if (!couriers.length) return `<div class="empty">No hay motorizados activos en este momento.</div>`;
  return `<p class="muted">Estado de disponibilidad de cada motorizado conectado.</p><div class="list">${couriers.map((profile) => {
    const currentOrders = state.orders.filter((order) => order.courier_id === profile.id && ["assigned", "at_store", "in_transit"].includes(order.status));
    const isBusy = currentOrders.length > 0;
    const orderDetails = currentOrders.map((order) => `${escapeHtml(order.allies?.name || "Aliado")} · ${escapeHtml(order.client_name)} (#${order.id.slice(0, 8)}) — ${statusNames[order.status]}`).join("<br>");
    return `<article class="card order-top"><div><h3>${escapeHtml(profile.full_name)}</h3><p>@${escapeHtml(profile.username)} · ${escapeHtml(profile.phone || "Sin teléfono")}</p><p class="muted">Última conexión: ${dateTime(profile.last_seen_at)}</p>${isBusy ? `<p class="courier-work"><strong>Pedido${currentOrders.length > 1 ? "s" : ""} en curso:</strong><br>${orderDetails}</p>` : ""}</div><span class="badge ${isBusy ? "orange" : "green"}">${isBusy ? "Ocupado" : "Disponible"}</span></article>`;
  }).join("")}</div>`;
}

function monitoringCouriers() {
  const positions = new Map(state.courierLocations.map((location) => [location.courier_id, location]));
  const freshAfter = Date.now() - 90000;
  return activeCouriers().map((profile) => {
    const currentOrders = state.orders.filter((order) => order.courier_id === profile.id && ["assigned", "at_store", "in_transit"].includes(order.status));
    const location = positions.get(profile.id);
    const locationIsFresh = location && new Date(location.updated_at).getTime() > freshAfter;
    const busy = currentOrders.length > 0;
    const orderDescription = currentOrders.map((order) => `${escapeHtml(order.allies?.name || "Aliado")} · #${order.id.slice(0, 8)} · ${statusNames[order.status]}`).join("<br>");
    const positionDescription = locationIsFresh
      ? `Ubicación actualizada ${dateTime(location.updated_at)}${location.accuracy ? ` · precisión ±${Math.round(location.accuracy)} m` : ""}`
      : "Esperando ubicación GPS del teléfono";
    return `<article class="card monitoring-courier"><div><h3>${escapeHtml(profile.full_name)}</h3><p>${escapeHtml(profile.phone || "Sin teléfono")} · ${positionDescription}</p>${busy ? `<p class="courier-work"><strong>Ocupado:</strong><br>${orderDescription}</p>` : `<p class="courier-work">Disponible para tomar pedidos</p>`}</div><span class="badge ${busy ? "orange" : "green"}">${busy ? "Ocupado" : "Disponible"}</span></article>`;
  }).join("");
}

function renderMonitoring() {
  const couriers = activeCouriers();
  return `<p class="muted">Ubicaciones recientes de motorizados conectados. La posición se comparte mientras el motorizado está en línea y autorizó el GPS.</p>
    <p id="monitoring-data-warning" class="error ${state.monitoringLocationLoadError ? "" : "hidden"}">No se pudo consultar la tabla de ubicaciones. Ejecuta la actualización de <code>supabase/schema.sql</code> y verifica los permisos.</p>
    <div id="monitoring-map" class="monitoring-map" role="application" aria-label="Mapa de motorizados"></div>
    <p id="monitoring-map-message" class="fine-print">${couriers.length ? "Cargando mapa y ubicaciones..." : "No hay motorizados conectados ahora."}</p>
    ${state.courierLocationError ? `<p class="error">${escapeHtml(state.courierLocationError)}</p>` : ""}
    <div id="monitoring-couriers" class="list">${monitoringCouriers() || `<div class="empty">No hay motorizados conectados en este momento.</div>`}</div>
    <p class="fine-print">El mapa usa Leaflet y datos cartográficos de OpenStreetMap. El seguimiento se detiene cuando el motorizado cambia a OFF o cierra sesión.</p>`;
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (state.leafletPromise) return state.leafletPromise;
  state.leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet="true"]')) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      stylesheet.dataset.leaflet = "true";
      document.head.appendChild(stylesheet);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      state.leafletPromise = null;
      reject(new Error("No se pudo cargar Leaflet. Comprueba la conexión a internet."));
    };
    document.head.appendChild(script);
  });
  return state.leafletPromise;
}

async function initializeMonitoringMap() {
  const container = document.querySelector("#monitoring-map");
  if (!container) return;
  try {
    const leaflet = await loadLeaflet();
    if (state.screen !== "monitoreo" || !container.isConnected) return;
    if (state.monitoringMap && state.monitoringMapContainer !== container) {
      state.monitoringMap.remove();
      state.monitoringMap = null;
      state.monitoringMarkers = null;
      state.monitoringMapDidFit = false;
    }
    if (!state.monitoringMap) {
      state.monitoringMapContainer = container;
      state.monitoringMap = leaflet.map(container).setView([10.5, -66.9], 5);
      leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
      }).addTo(state.monitoringMap);
      state.monitoringMarkers = leaflet.layerGroup().addTo(state.monitoringMap);
    }
    refreshMonitoringMap();
  } catch (error) {
    console.error("No se pudo inicializar el mapa de monitoreo:", error);
    const message = document.querySelector("#monitoring-map-message");
    if (message) message.textContent = error.message;
  }
}

function monitoringLocations() {
  const profiles = new Map(activeCouriers().map((profile) => [profile.id, profile]));
  const freshAfter = Date.now() - 90000;
  return state.courierLocations
    .filter((location) => profiles.has(location.courier_id) && new Date(location.updated_at).getTime() > freshAfter)
    .map((location) => ({ ...location, profile: profiles.get(location.courier_id) }));
}

function refreshMonitoringMap() {
  if (!state.monitoringMap || !state.monitoringMarkers) return;
  const leaflet = window.L;
  const locations = monitoringLocations();
  state.monitoringMarkers.clearLayers();
  const bounds = [];

  for (const location of locations) {
    const busy = state.orders.some((order) => order.courier_id === location.courier_id && ["assigned", "at_store", "in_transit"].includes(order.status));
    const name = escapeHtml(location.profile.full_name);
    const marker = leaflet.circleMarker([location.latitude, location.longitude], {
      radius: 9,
      color: busy ? "#ff707b" : "#42d392",
      fillColor: busy ? "#ff707b" : "#42d392",
      fillOpacity: 0.9,
      weight: 2
    });
    marker.bindTooltip(name, {
      permanent: true,
      direction: "top",
      offset: [0, -8],
      className: "courier-map-label",
      opacity: 1
    });
    marker.bindPopup(`<strong>${name}</strong><br>${busy ? "Ocupado" : "Disponible"}<br>Actualizado: ${dateTime(location.updated_at)}`);
    marker.addTo(state.monitoringMarkers);
    bounds.push([location.latitude, location.longitude]);
  }

  if (bounds.length && !state.monitoringMapDidFit) {
    state.monitoringMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    state.monitoringMapDidFit = true;
  }
  const message = document.querySelector("#monitoring-map-message");
  if (message) {
    message.textContent = locations.length
      ? `${locations.length} ubicación${locations.length === 1 ? "" : "es"} reciente${locations.length === 1 ? "" : "s"} en el mapa.`
      : "No hay posiciones GPS recientes. Verifica que los motorizados estén en línea y hayan permitido la ubicación.";
  }
}

function refreshMonitoringView() {
  const list = document.querySelector("#monitoring-couriers");
  if (!list) return;
  const warning = document.querySelector("#monitoring-data-warning");
  warning?.classList.toggle("hidden", !state.monitoringLocationLoadError);
  list.innerHTML = monitoringCouriers() || `<div class="empty">No hay motorizados conectados en este momento.</div>`;
  refreshMonitoringMap();
}

function renderDashboard() {
  const role = state.profile.role;
  const today = dayStart();
  const createdToday = state.orders.filter((order) => new Date(order.created_at) >= today && (role !== "motorizado" || order.courier_id === state.profile.id));
  const completed = state.orders.filter((order) => order.status === "delivered" && new Date(order.delivered_at) >= today);
  const revenue = completed.reduce((sum, order) => sum + (role === "motorizado" ? courierEarnings(order) : Number(order.delivery_fee)), 0);
  const activeOrders = state.orders.filter((order) => order.status !== "delivered");
  return `<div class="grid metrics">
    <article class="card"><span class="metric-label">Pedidos creados hoy</span><div class="metric-value">${createdToday.length}</div><span class="metric-foot">${completed.length} entregas finalizadas</span></article>
    <article class="card"><span class="metric-label">${role === "motorizado" ? "Tu ganancia hoy (70%)" : "Delivery generado hoy"}</span><div class="metric-value">${formatMoney(revenue)}</div><span class="metric-foot">${role === "motorizado" ? "Tu parte de los pedidos entregados" : "Suma de costos de delivery"}</span></article>
    <article class="card"><span class="metric-label">Motorizados activos</span><div class="metric-value">${role === "motorizado" ? (state.profile.online ? "1" : "0") : countOnline()}</div><span class="metric-foot">Disponibles en este momento</span></article>
  </div>
  <div class="section-head"><h2>${role === "motorizado" ? "Tus entregas activas" : "Pedidos en curso"}</h2></div>
  <div class="list">${renderOrderCards(activeOrders.filter((order) => role !== "motorizado" || order.courier_id === state.profile.id).slice(0, 5), "dashboard")}</div>`;
}

function statusBadge(status) {
  const color = status === "delivered" ? "green" : status === "pending" ? "gray" : status === "in_transit" ? "orange" : "";
  const label = status === "pending" && state.profile.role !== "motorizado" ? "Pendiente de asignación" : statusNames[status] || status;
  return `<span class="badge ${color}">${label}</span>`;
}

function whatsappUrl(phone, allyName) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `57${digits}`;
  const message = `Buenas, soy el delivery de ${allyName}, ya estoy recogiendo su pedido, me confirma su ubicación por favor.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function courierEarnings(order) {
  return Number(order.delivery_fee || 0) * 0.7;
}

function orderDeadline(order) {
  if (order.status === "pending") return new Date(order.assigned_at || order.created_at).getTime() + 10 * 60 * 1000;
  if (order.status === "assigned" && !order.at_store_at) return new Date(order.assigned_at || order.created_at).getTime() + 10 * 60 * 1000;
  return null;
}

function renderDeadline(order) {
  if (!["soporte", "administracion"].includes(state.profile.role)) return "";
  const deadline = orderDeadline(order);
  if (!deadline) return "";
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const overdue = seconds === 0;
  const display = overdue ? `RETRASADO +${formatElapsed(-seconds)}` : `Llegada al comercio en ${formatElapsed(seconds)}`;
  return `<div class="deadline ${overdue ? "overdue" : ""}" data-deadline="${deadline}" data-order-id="${order.id}">${display}</div>`;
}

function formatElapsed(seconds) {
  const safeSeconds = Math.abs(seconds);
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function updateOverdueClocks() {
  const now = Date.now();
  document.querySelectorAll(".deadline[data-deadline]").forEach((node) => {
    const deadline = Number(node.dataset.deadline);
    const seconds = Math.ceil((deadline - now) / 1000);
    const overdue = seconds <= 0;
    node.classList.toggle("overdue", overdue);
    node.closest(".order-card")?.classList.toggle("late", overdue);
    node.textContent = overdue
      ? `RETRASADO +${formatElapsed(-seconds)}`
      : `Llegada al comercio en ${formatElapsed(seconds)}`;
  });

  if (!state.overdueSoundsEnabled || document.hidden) return;
  let shouldAlarm = false;
  for (const order of state.orders) {
    const deadline = orderDeadline(order);
    if (!deadline || now < deadline) continue;
    const lastAlarm = state.overdueAlarmTimes.get(order.id) || 0;
    if (now - lastAlarm < 2 * 60 * 1000) continue;
    state.overdueAlarmTimes.set(order.id, now);
    shouldAlarm = true;
  }
  if (shouldAlarm) void playOverdueAlarm();
}

async function enableOverdueSounds() {
  if (state.overdueSoundsEnabled) {
    state.overdueSoundsEnabled = false;
    showToast("Alarma de pedidos retrasados desactivada.");
    renderApp();
    return;
  }
  try {
    await prepareAlertAudio("overdue");
    state.overdueSoundsEnabled = true;
    showToast("Alarma activada con el audio de peligro clásico.");
    renderApp();
  } catch (error) {
    reportError(error);
  }
}

async function playOverdueAlarm() {
  if (!state.overdueSoundsEnabled) return;
  await playAlertAudio("overdue");
}

function renderOrderCards(orders, context = "") {
  if (!orders.length) return `<div class="empty">No hay pedidos para mostrar.</div>`;
  return orders.map((order) => {
    const allyName = order.allies?.name || "Aliado";
    const ally = escapeHtml(allyName);
    const courier = escapeHtml(order.courier?.full_name || "Sin asignar");
    const buttons = [];
    if (context === "available") {
      buttons.push(`<span class="badge green courier-earnings">Tu ganancia: ${formatMoney(courierEarnings(order))}</span>`);
      buttons.push(`<button class="button primary small" data-action="claim" data-id="${order.id}">Tomar pedido</button>`);
    }
    if (context === "current") {
      const next = { assigned: ["at_store", "Llegada al comercio"], at_store: ["in_transit", "Pedido en camino"], in_transit: ["delivered", "Pedido entregado"] }[order.status];
      if (next) buttons.push(`<button class="button ${next[0] === "delivered" ? "success" : "primary"} small" data-action="advance" data-status="${next[0]}" data-id="${order.id}">${next[1]}</button>`);
      buttons.push(`<button class="button subtle small" data-action="maps" data-url="${escapeHtml(order.maps_url || "")}">Abrir ubicación</button>`);
      buttons.push(`<button class="button subtle small" data-action="copy-phone" data-phone="${escapeHtml(order.client_phone)}">Copiar teléfono</button>`);
      buttons.push(`<a class="button success small" target="_blank" rel="noopener noreferrer" href="${whatsappUrl(order.client_phone, allyName)}">Contactar cliente</a>`);
    }
    if (context === "pending" && !order.released) buttons.push(`<button class="button primary small" data-action="release" data-id="${order.id}">Liberar pedido</button>`);
    if (context === "staff" && order.status === "assigned" && !order.at_store_at && ["administracion", "soporte"].includes(state.profile.role)) {
      buttons.push(`<label class="assign-control">Nuevo motorizado<select data-reassign-select="${order.id}"><option value="">Selecciona un motorizado activo…</option>${activeCouriers().filter((profile) => profile.id !== order.courier_id).map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name)}</option>`).join("")}</select></label>`);
      buttons.push(`<button class="button primary small" data-action="reassign" data-id="${order.id}">Reasignar pedido</button>`);
      buttons.push(`<button class="button subtle small" data-action="release" data-id="${order.id}">Liberar para que otro lo tome</button>`);
    } else if (["staff", "pending"].includes(context) && ["administracion", "soporte"].includes(state.profile.role) && order.status === "pending") {
      buttons.push(`<label class="assign-control">Asignar motorizado<select data-action="assign" data-id="${order.id}"><option value="">${order.courier_id ? "Cambiar asignación…" : "Seleccionar…"}</option>${state.profiles.filter((profile) => profile.role === "motorizado" && profile.approved && !profile.suspended).map((profile) => `<option value="${profile.id}" ${profile.id === order.courier_id ? "selected" : ""}>${escapeHtml(profile.full_name)}</option>`).join("")}</select></label>`);
    }
    const isCourier = state.profile.role === "motorizado";
    const priceLabel = isCourier ? `<strong>Tu ganancia (70%):</strong> ${formatMoney(courierEarnings(order))}` : `<strong>Delivery:</strong> ${formatMoney(order.delivery_fee)}`;
    const orderStatus = order.status === "pending" && order.released === false && ["soporte", "administracion"].includes(state.profile.role)
      ? `<span class="badge orange">Pendiente de soporte</span>`
      : statusBadge(order.status);
    return `<article class="order-card"><div class="order-top"><div><h3>${ally} <span class="muted">· ${escapeHtml(order.client_name)}</span></h3><p>Pedido #${order.id.slice(0, 8)} · ${dateTime(order.created_at)}</p></div>${orderStatus}</div>
      ${renderDeadline(order)}
      ${context === "current" && order.allies?.location_url ? `<div class="merchant-location"><button class="button subtle small" data-action="maps" data-url="${escapeHtml(order.allies.location_url)}">Ubicación del comercio</button></div>` : ""}
      <p class="order-detail"><strong>Cliente:</strong> ${escapeHtml(order.client_name)} · ${escapeHtml(order.client_phone)}<br><strong>Dirección:</strong> ${escapeHtml(order.address)}<br><strong>Motorizado:</strong> ${courier === "Sin asignar" ? escapeHtml(order.courier_name || courier) : courier}<br><strong>Creado por:</strong> ${escapeHtml(order.creator?.full_name || order.creator_name || "—")}${context === "completed" ? `<br><strong>Recogida en comercio:</strong> ${dateTime(order.at_store_at)}<br><strong>Entrega:</strong> ${dateTime(order.delivered_at)}` : ""}<br>${priceLabel}</p>
      ${buttons.length ? `<div class="order-actions">${buttons.join("")}</div>` : ""}</article>`;
  }).join("");
}

function renderCourierAvailable() {
  const orders = state.orders.filter((order) => order.status === "pending" && order.released !== false);
  return `<p class="muted">Toma un pedido disponible para asignarlo a tu cuenta. Solo podrás recibir pedidos mientras estés activo.</p><div class="list">${renderOrderCards(state.profile.online ? orders : [], "available")}</div>`;
}

function renderCourierCurrent() {
  const orders = state.orders.filter((order) => order.courier_id === state.profile.id && order.status !== "delivered");
  return `<div class="list">${renderOrderCards(orders, "current")}</div>`;
}

function renderCourierDelivered() {
  return `<div class="toolbar"><label>Periodo<select id="period-select"><option value="day" ${state.period === "day" ? "selected" : ""}>Hoy</option><option value="week" ${state.period === "week" ? "selected" : ""}>Esta semana</option><option value="month" ${state.period === "month" ? "selected" : ""}>Este mes</option><option value="all" ${state.period === "all" ? "selected" : ""}>Todo el historial</option><option value="custom" ${state.period === "custom" ? "selected" : ""}>Elegir fechas</option></select></label>
    <label class="custom-date ${state.period === "custom" ? "" : "hidden"}">Desde<input type="date" id="date-from"></label><label class="custom-date ${state.period === "custom" ? "" : "hidden"}">Hasta<input type="date" id="date-to"></label>
  </div><div id="delivered-results">${deliveredSummary()}</div>`;
}

function filteredDelivered() {
  const now = new Date();
  const list = state.orders.filter((order) => order.status === "delivered" && order.courier_id === state.profile.id);
  if (state.period === "all" || state.period === "custom") return list;
  const start = dayStart(now);
  if (state.period === "week") {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
  }
  if (state.period === "month") start.setDate(1);
  return list.filter((order) => new Date(order.delivered_at) >= start);
}

function deliveredSummary() {
  const orders = filteredDelivered();
  const amount = orders.reduce((sum, order) => sum + courierEarnings(order), 0);
  return `<div class="grid metrics"><article class="card"><span class="metric-label">Pedidos en el periodo</span><div class="metric-value">${orders.length}</div></article><article class="card"><span class="metric-label">Ganancia (70%)</span><div class="metric-value">${formatMoney(amount)}</div></article><article class="card"><span class="metric-label">Ganancia de hoy</span><div class="metric-value">${formatMoney(filteredToday().reduce((sum, order) => sum + courierEarnings(order), 0))}</div></article></div><div class="section-head"><h2>Historial de entregas</h2></div><div class="list">${renderOrderCards(orders, "completed")}</div>`;
}

function filteredToday() {
  return state.orders.filter((order) => order.status === "delivered" && order.courier_id === state.profile.id && new Date(order.delivered_at) >= dayStart());
}

function renderCompletedOrders() {
  const orders = state.orders.filter((order) => order.status === "delivered");
  return `<div class="section-head"><h2>Pedidos finalizados</h2></div><div class="list">${renderOrderCards(orders, "completed")}</div>`;
}

function renderStaffOrders() {
  return `<div class="toolbar"><label>Filtrar por estado<select id="staff-status"><option value="active">En curso</option><option value="pending">Sin asignar</option><option value="assigned">Asignados</option><option value="at_store">En el comercio</option><option value="in_transit">En camino</option><option value="all">Todos</option></select></label></div><div id="staff-orders" class="list">${renderOrderCards(state.orders.filter((order) => order.status !== "delivered"), "staff")}</div>`;
}

function renderCreateOrder() {
  const isAlly = state.profile.role === "aliado";
  const linkedAlly = state.allies.find((ally) => ally.id === state.profile.ally_id);
  return `<article class="card form-card"><form id="create-order" class="form-grid">
    ${isAlly
      ? `<div class="card wide"><strong>Aliado:</strong> ${escapeHtml(linkedAlly?.name || "Sin aliado asignado")}${linkedAlly?.location_url ? ` · <a href="${escapeHtml(linkedAlly.location_url)}" target="_blank" rel="noopener noreferrer">Ver GPS del comercio</a>` : ""}</div>`
      : `<label>Aliado comercial<select name="allyId" required><option value="">Selecciona un aliado</option>${state.allies.map((ally) => `<option value="${ally.id}">${escapeHtml(ally.name)}</option>`).join("")}</select></label>
        <label class="inline-checkbox"><input type="checkbox" id="assign-courier-toggle">Asignar repartidor ahora</label>
        <label class="wide hidden" id="assigned-courier-field">Motorizado activo<select name="courierId" id="assigned-courier"><option value="">Selecciona un motorizado activo</option>${activeCouriers().map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name)} (@${escapeHtml(profile.username)})</option>`).join("")}</select><span class="muted">Solo aparecen motorizados activos ahora.</span></label>`}
    <label>Nombre del cliente<input name="clientName" required></label>
    <label>Teléfono del cliente<input name="clientPhone" type="tel" required></label>
    <label>Precio del delivery<input name="deliveryFee" type="number" min="0" step="any" inputmode="decimal" required></label>
    <label class="wide">Dirección escrita<textarea name="address" required></textarea></label>
    <label class="wide">Ubicación de Google Maps (URL)<input name="mapsUrl" type="url" placeholder="https://maps.google.com/..." required></label>
    <div class="wide"><button class="button primary" type="submit">Crear pedido</button></div>
  </form></article>`;
}

function renderAllies() {
  const isAdmin = state.profile.role === "administracion";
  return `<div class="section-head"><h2>Aliados comerciales</h2></div>${isAdmin ? `<form id="ally-form" class="form-grid card"><label>Nombre del aliado<input name="name" required></label><label>Ubicación GPS del comercio (URL)<input name="locationUrl" type="url" placeholder="https://maps.google.com/..."></label><div class="wide"><button class="button primary">Agregar aliado</button></div></form>` : ""}
    <div class="list">${state.allies.length ? state.allies.map((ally) => `<article class="card order-top"><div><h3>${escapeHtml(ally.name)}</h3><p class="muted">Creado ${dateTime(ally.created_at)}</p>${ally.location_url ? `<a class="text-button" href="${escapeHtml(ally.location_url)}" target="_blank" rel="noopener noreferrer">Ver ubicación del comercio</a>` : ""}</div>${isAdmin ? `<button class="button danger small" data-action="delete-ally" data-id="${ally.id}">Eliminar</button>` : ""}</article>`).join("") : `<div class="empty">Aún no hay aliados registrados.</div>`}</div>`;
}

function renderUsers() {
  return `<div class="section-head"><h2>Usuarios y permisos</h2></div><div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Nombre y teléfono</th><th>Rol</th><th>Aliado asignado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${state.profiles.map((profile) => `<tr><td>@${escapeHtml(profile.username)}</td><td><input aria-label="Nombre completo" data-profile-name="${profile.id}" value="${escapeHtml(profile.full_name)}"><input aria-label="Teléfono" data-profile-phone="${profile.id}" value="${escapeHtml(profile.phone || "")}" style="margin-top:6px"></td><td><select data-action="role" data-id="${profile.id}"><option value="">Sin rol</option>${Object.entries(roleNames).map(([value, label]) => `<option value="${value}" ${profile.role === value ? "selected" : ""}>${label}</option>`).join("")}</select></td><td><select aria-label="Aliado del usuario" data-profile-ally="${profile.id}"><option value="">Sin aliado</option>${state.allies.map((ally) => `<option value="${ally.id}" ${profile.ally_id === ally.id ? "selected" : ""}>${escapeHtml(ally.name)}</option>`).join("")}</select></td><td>${profile.suspended ? `<span class="badge">Suspendido</span>` : profile.approved ? `<span class="badge green">${profile.online ? "Activo" : "Aprobado"}</span>` : `<span class="badge orange">Pendiente</span>`}</td><td class="user-actions"><button class="button subtle small" data-action="save-profile" data-id="${profile.id}">Guardar</button><button class="button ${profile.suspended ? "success" : "danger"} small" data-action="suspend" data-id="${profile.id}" data-suspended="${profile.suspended}">${profile.suspended ? "Reactivar" : "Suspender"}</button><button class="button danger small" data-action="delete-user" data-id="${profile.id}">Eliminar</button></td></tr>`).join("")}</tbody></table></div><p class="fine-print">Para cuentas con rol Aliado, asigna también el aliado comercial correspondiente. Eliminar acceso conserva el historial.</p>`;
}

function renderReports() {
  const delivered = state.orders.filter((order) => order.status === "delivered");
  const todayDelivered = delivered.filter((order) => new Date(order.delivered_at) >= dayStart());
  const createdToday = state.orders.filter((order) => new Date(order.created_at) >= dayStart());
  const couriers = state.profiles.filter((profile) => profile.role === "motorizado");
  return `<div class="grid metrics"><article class="card"><span class="metric-label">Pedidos creados hoy</span><div class="metric-value">${createdToday.length}</div><span class="metric-foot">${todayDelivered.length} entregados</span></article><article class="card"><span class="metric-label">Delivery generado hoy</span><div class="metric-value">${formatMoney(todayDelivered.reduce((sum, order) => sum + Number(order.delivery_fee), 0))}</div></article><article class="card"><span class="metric-label">Motorizados activos</span><div class="metric-value">${countOnline()}</div></article></div>
    <div class="section-head"><h2>Reportes de entregas</h2></div><div class="toolbar">
      <label>Desde<input type="date" id="report-from"></label>
      <label>Hasta<input type="date" id="report-to"></label>
      <label>Motorizado<select id="report-courier"><option value="">Todos los motorizados</option>${couriers.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name)}</option>`).join("")}</select></label>
      <label>Aliado<select id="report-ally"><option value="">Todos los aliados</option>${state.allies.map((ally) => `<option value="${ally.id}">${escapeHtml(ally.name)}</option>`).join("")}</select></label>
      <button class="button primary" data-action="export">Descargar reporte Excel</button>
    </div>
    <div id="report-table" class="table-wrap">${reportTable(reportOrders())}</div>`;
}

function averageDurationSeconds(orders, startField, endField) {
  const durations = orders
    .filter((order) => order[startField] && order[endField])
    .map((order) => (new Date(order[endField]).getTime() - new Date(order[startField]).getTime()) / 1000)
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
  if (!durations.length) return null;
  return durations.reduce((total, seconds) => total + seconds, 0) / durations.length;
}

function formatDuration(seconds) {
  if (seconds === null) return "—";
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return `${minutes} min ${remainingSeconds} s`;
  return `${remainingSeconds} s`;
}

function renderMetrics() {
  const today = dayStart();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const deliveredToday = state.orders.filter((order) => order.status === "delivered"
    && new Date(order.delivered_at) >= today
    && new Date(order.delivered_at) < tomorrow);
  const createdToday = state.orders.filter((order) => new Date(order.created_at) >= today && new Date(order.created_at) < tomorrow);
  const avgAcceptance = averageDurationSeconds(createdToday, "created_at", "assigned_at");
  const avgDelivery = averageDurationSeconds(deliveredToday, "at_store_at", "delivered_at");
  const ordersByCourier = new Map();

  const courierMetrics = (name) => ({ name, orders: [], acceptanceOrders: [] });

  for (const order of deliveredToday) {
    if (!order.courier_id) continue;
    const existing = ordersByCourier.get(order.courier_id) || courierMetrics(order.courier?.full_name || order.courier_name || "Motorizado");
    existing.orders.push(order);
    ordersByCourier.set(order.courier_id, existing);
  }

  for (const order of createdToday.filter((item) => item.assigned_at && item.courier_id)) {
    const existing = ordersByCourier.get(order.courier_id) || courierMetrics(order.courier?.full_name || order.courier_name || "Motorizado");
    existing.acceptanceOrders.push(order);
    ordersByCourier.set(order.courier_id, existing);
  }

  for (const profile of state.profiles.filter((item) => item.role === "motorizado")) {
    if (!ordersByCourier.has(profile.id)) {
      ordersByCourier.set(profile.id, courierMetrics(profile.full_name));
    }
  }

  const ranking = [...ordersByCourier.values()].sort((left, right) =>
    right.orders.length - left.orders.length || left.name.localeCompare(right.name, "es")
  );
  const topCourier = ranking[0]?.orders.length ? ranking[0].name : "—";
  const rankingRows = ranking.map(({ name, orders, acceptanceOrders }) => {
    const acceptance = averageDurationSeconds(acceptanceOrders, "created_at", "assigned_at");
    const delivery = averageDurationSeconds(orders, "at_store_at", "delivered_at");
    return `<tr><td>${escapeHtml(name)}</td><td>${orders.length}</td><td>${formatDuration(acceptance)}</td><td>${formatDuration(delivery)}</td></tr>`;
  }).join("");

  return `<div class="grid metrics">
    <article class="card"><span class="metric-label">Pedidos entregados hoy</span><div class="metric-value">${deliveredToday.length}</div></article>
    <article class="card"><span class="metric-label">Motorizado con más entregas</span><div class="metric-value metric-text">${escapeHtml(topCourier)}</div><span class="metric-foot">${ranking[0]?.orders.length || 0} pedidos completados hoy</span></article>
    <article class="card"><span class="metric-label">Promedio de aceptación</span><div class="metric-value">${formatDuration(avgAcceptance)}</div><span class="metric-foot">Desde creación hasta asignación, pedidos creados hoy</span></article>
    <article class="card"><span class="metric-label">Promedio de entrega</span><div class="metric-value">${formatDuration(avgDelivery)}</div><span class="metric-foot">Desde llegada al comercio hasta entrega, finalizados hoy</span></article>
  </div>
  <div class="section-head"><h2>Desempeño de motorizados · hoy</h2></div>
  <div class="table-wrap"><table><thead><tr><th>Motorizado</th><th>Pedidos entregados</th><th>Promedio de aceptación</th><th>Promedio de entrega</th></tr></thead><tbody>${rankingRows || `<tr><td colspan="4">No hay motorizados registrados.</td></tr>`}</tbody></table></div>`;
}

function reportTable(orders) {
  return `<table><thead><tr><th>Aliado</th><th>Cliente</th><th>Dirección</th><th>Motorizado</th><th>Creado por</th><th>Hora comercio</th><th>Hora entrega</th><th>Fecha</th><th>Delivery</th></tr></thead><tbody>${orders.length ? orders.map((order) => `<tr><td>${escapeHtml(order.allies?.name)}</td><td>${escapeHtml(order.client_name)}</td><td>${escapeHtml(order.address)}</td><td>${escapeHtml(order.courier?.full_name || order.courier_name || "")}</td><td>${escapeHtml(order.creator?.full_name || order.creator_name || "—")}</td><td>${dateTime(order.at_store_at)}</td><td>${dateTime(order.delivered_at)}</td><td>${new Date(order.delivered_at).toLocaleDateString("es-CO")}</td><td>${formatMoney(order.delivery_fee)}</td></tr>`).join("") : `<tr><td colspan="9">Sin pedidos para el periodo seleccionado.</td></tr>`}</tbody></table>`;
}

function reportOrders() {
  const from = document.querySelector("#report-from")?.value;
  const to = document.querySelector("#report-to")?.value;
  const courierId = document.querySelector("#report-courier")?.value;
  const allyId = document.querySelector("#report-ally")?.value;
  const endExclusive = to ? new Date(`${to}T00:00:00`) : null;
  if (endExclusive) endExclusive.setDate(endExclusive.getDate() + 1);
  return state.orders.filter((order) => order.status === "delivered"
    && (!from || new Date(order.delivered_at) >= new Date(`${from}T00:00:00`))
    && (!endExclusive || new Date(order.delivered_at) < endExclusive)
    && (!courierId || order.courier_id === courierId)
    && (!allyId || order.ally_id === allyId));
}

function bindScreenActions() {
  const createForm = document.querySelector("#create-order");
  if (createForm) createForm.addEventListener("submit", createOrder);
  const assignCourierToggle = document.querySelector("#assign-courier-toggle");
  if (assignCourierToggle) assignCourierToggle.addEventListener("change", () => {
    const courierField = document.querySelector("#assigned-courier-field");
    const courierSelect = document.querySelector("#assigned-courier");
    courierField.classList.toggle("hidden", !assignCourierToggle.checked);
    courierSelect.required = assignCourierToggle.checked;
    if (!assignCourierToggle.checked) courierSelect.value = "";
  });
  const allyForm = document.querySelector("#ally-form");
  if (allyForm) allyForm.addEventListener("submit", createAlly);
  const staffStatus = document.querySelector("#staff-status");
  if (staffStatus) staffStatus.addEventListener("change", () => {
    const value = staffStatus.value;
    const orders = value === "active" ? state.orders.filter((order) => order.status !== "delivered") : value === "all" ? state.orders : state.orders.filter((order) => order.status === value);
    document.querySelector("#staff-orders").innerHTML = renderOrderCards(orders, "staff");
    bindOrderActions();
  });
  const period = document.querySelector("#period-select");
  if (period) period.addEventListener("change", () => {
    state.period = period.value;
    renderApp();
  });
  document.querySelectorAll("#date-from, #date-to").forEach((input) => input.addEventListener("change", () => {
    const from = document.querySelector("#date-from")?.value;
    const to = document.querySelector("#date-to")?.value;
    if (from && to) {
      const orders = state.orders.filter((order) => order.status === "delivered" && order.courier_id === state.profile.id && new Date(order.delivered_at) >= new Date(`${from}T00:00:00`) && new Date(order.delivered_at) <= new Date(`${to}T23:59:59.999`));
      document.querySelector("#delivered-results").innerHTML = deliveredSummaryFor(orders);
    }
  }));
  document.querySelectorAll("#report-from, #report-to, #report-courier, #report-ally").forEach((input) => input.addEventListener("change", () => {
    document.querySelector("#report-table").innerHTML = reportTable(reportOrders());
  }));
  bindOrderActions();
}

function deliveredSummaryFor(orders) {
  const amount = orders.reduce((sum, order) => sum + courierEarnings(order), 0);
  return `<div class="grid metrics"><article class="card"><span class="metric-label">Pedidos en el periodo</span><div class="metric-value">${orders.length}</div></article><article class="card"><span class="metric-label">Ganancia (70%)</span><div class="metric-value">${formatMoney(amount)}</div></article><article class="card"><span class="metric-label">Ganancia de hoy</span><div class="metric-value">${formatMoney(filteredToday().reduce((sum, order) => sum + courierEarnings(order), 0))}</div></article></div><div class="section-head"><h2>Historial de entregas</h2></div><div class="list">${renderOrderCards(orders, "completed")}</div>`;
}

function bindOrderActions() {
  document.querySelectorAll('[data-action="claim"]').forEach((button) => button.addEventListener("click", () => updateOrder(button.dataset.id, "claim_order")));
  document.querySelectorAll('[data-action="advance"]').forEach((button) => button.addEventListener("click", () => updateOrder(button.dataset.id, "advance_order", { next_status: button.dataset.status })));
  document.querySelectorAll('[data-action="assign"]').forEach((select) => select.addEventListener("change", () => {
    if (select.value) updateOrder(select.dataset.id, "assign_order", { target_courier: select.value });
  }));
  document.querySelectorAll('[data-action="release"]').forEach((button) => button.addEventListener("click", () => updateOrder(button.dataset.id, "release_order")));
  document.querySelectorAll('[data-action="reassign"]').forEach((button) => button.addEventListener("click", () => {
    const select = document.querySelector(`[data-reassign-select="${button.dataset.id}"]`);
    if (!select?.value) return showToast("Selecciona el motorizado que recibirá el pedido.", true);
    updateOrder(button.dataset.id, "assign_order", { target_courier: select.value });
  }));
  document.querySelectorAll('[data-action="copy-phone"]').forEach((button) => button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.phone);
      showToast("Teléfono copiado.");
    } catch (error) {
      reportError(new Error(`No se pudo copiar el teléfono: ${error.message}`));
    }
  }));
  document.querySelectorAll('[data-action="maps"]').forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.url) window.open(button.dataset.url, "_blank", "noopener,noreferrer");
  }));
  document.querySelectorAll('[data-action="save-profile"]').forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.id;
    const full_name = document.querySelector(`[data-profile-name="${id}"]`).value.trim();
    const phone = document.querySelector(`[data-profile-phone="${id}"]`).value.trim();
    if (!full_name || !phone) return showToast("Nombre y teléfono son obligatorios.", true);
    const role = document.querySelector(`[data-action="role"][data-id="${id}"]`).value || null;
    const allyId = document.querySelector(`[data-profile-ally="${id}"]`).value || null;
    if (role === "aliado" && !allyId) return showToast("Asigna un aliado comercial a este usuario.", true);
    updateProfile(id, { full_name, phone, role, approved: Boolean(role), ally_id: role === "aliado" ? allyId : null });
  }));
  document.querySelectorAll('[data-action="suspend"]').forEach((button) => button.addEventListener("click", () => updateProfile(button.dataset.id, { suspended: button.dataset.suspended !== "true", online: false })));
  document.querySelectorAll('[data-action="delete-user"]').forEach((button) => button.addEventListener("click", () => deleteUser(button.dataset.id)));
  document.querySelectorAll('[data-action="delete-ally"]').forEach((button) => button.addEventListener("click", () => deleteAlly(button.dataset.id)));
  const exportButton = document.querySelector('[data-action="export"]');
  if (exportButton) exportButton.addEventListener("click", exportReport);
}

async function toggleOnline(event) {
  const online = event.currentTarget.checked;
  const { error } = await supabase.rpc("set_courier_online", { is_online: online });
  if (error) {
    event.currentTarget.checked = !online;
    return reportError(error);
  }
  state.profile.online = online;
  if (online) startCourierLocationTracking();
  else {
    stopCourierLocationTracking();
    state.courierLocations = state.courierLocations.filter((location) => location.courier_id !== state.profile.id);
  }
  showToast(online ? "Estás activo. Se solicitará permiso de ubicación para aparecer en Monitoreo." : "Quedaste desconectado; tu ubicación fue retirada del monitoreo.");
  await refreshData(true);
  renderApp();
}

async function createOrder(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const mapsUrl = String(data.get("mapsUrl")).trim();
  const isAlly = state.profile.role === "aliado";
  const assignedCourier = !isAlly && Boolean(document.querySelector("#assign-courier-toggle")?.checked);
  const allyId = isAlly ? state.profile.ally_id : data.get("allyId");
  if (!allyId) return showToast("Esta cuenta no tiene un aliado asignado. Contacta a administración.", true);
  if (!/^https?:\/\/\S+$/i.test(mapsUrl)) return showToast("La ubicación debe ser una URL http o https.", true);
  const { data: orderId, error } = await supabase.rpc("create_order", {
    p_ally_id: allyId,
    p_client_name: String(data.get("clientName")).trim(),
    p_client_phone: String(data.get("clientPhone")).trim(),
    p_address: String(data.get("address")).trim(),
    p_maps_url: mapsUrl,
    p_delivery_fee: Number(data.get("deliveryFee")),
    p_courier_id: assignedCourier ? data.get("courierId") : null
  });
  if (error) return reportError(error);
  showToast(isAlly ? "Pedido enviado a soporte; ningún motorizado lo verá todavía." : assignedCourier ? "Pedido creado y asignado al motorizado." : "Pedido creado y disponible para los motorizados.");
  state.screen = isAlly ? "mis_pedidos" : "pedidos";
  await refreshData(false);
  renderApp();
  applyPendingServiceWorkerUpdate();
  return orderId;
}

async function createAlly(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = form.get("name").toString().trim();
  const locationUrl = form.get("locationUrl").toString().trim();
  if (locationUrl && !/^https?:\/\/\S+$/i.test(locationUrl)) return showToast("La ubicación debe ser una URL http o https.", true);
  const { error } = await supabase.from("allies").insert({ name, location_url: locationUrl || null });
  if (error) return reportError(error);
  showToast("Aliado agregado.");
  await refreshData(false);
  renderApp();
}

async function deleteAlly(id) {
  if (!window.confirm("¿Eliminar este aliado?")) return;
  const { error } = await supabase.from("allies").delete().eq("id", id);
  if (error) return reportError(error);
  showToast("Aliado eliminado.");
  await refreshData(false);
  renderApp();
}

async function deleteUser(id) {
  if (id === state.profile.id) return showToast("No puedes eliminar tu propia cuenta de administración.", true);
  if (!window.confirm("¿Eliminar el acceso de este usuario? Los pedidos realizados permanecerán en el historial.")) return;
  const { error } = await supabase.rpc("delete_user_account", { target_user: id });
  if (error) return reportError(error);
  showToast("Cuenta eliminada; se conservó el historial de pedidos.");
  await refreshData(false);
  renderApp();
}

async function updateOrder(id, action, args = {}) {
  const previousOrder = action === "claim_order" ? state.orders.find((order) => order.id === id) : null;
  if (action === "claim_order") {
    state.orders = state.orders.map((order) => order.id === id
      ? { ...order, status: "assigned", courier_id: state.profile.id, courier_name: state.profile.full_name, assigned_at: new Date().toISOString(), courier: { full_name: state.profile.full_name, username: state.profile.username } }
      : order);
    if (state.screen === "activos") renderApp();
  }
  const { error } = await supabase.rpc(action, { order_id: id, ...args });
  if (error) {
    if (previousOrder) {
      state.orders = state.orders.map((order) => order.id === id ? previousOrder : order);
      renderApp();
    }
    return reportError(error);
  }
  showToast(action === "claim_order" ? "Pedido asignado a tu cuenta." : action === "assign_order" ? "Pedido asignado al motorizado." : action === "release_order" ? "Pedido liberado para motorizados activos." : "Estado del pedido actualizado.");
  await refreshData(true);
  renderApp();
}

async function updateProfile(id, changes) {
  const { error } = await supabase.from("profiles").update(changes).eq("id", id);
  if (error) return reportError(error);
  if (id === state.profile.id) state.profile = { ...state.profile, ...changes };
  showToast("Usuario actualizado.");
  await refreshData(false);
  renderApp();
}

function exportReport() {
  const columns = [
    ["Aliado", (order) => order.allies?.name || ""],
    ["Cliente", (order) => order.client_name],
    ["Direccion", (order) => order.address],
    ["Motorizado", (order) => order.courier?.full_name || ""],
    ["Creado por", (order) => order.creator?.full_name || order.creator_name || ""],
    ["Hora llegada comercio", (order) => order.at_store_at ? new Date(order.at_store_at).toLocaleTimeString("es-CO") : ""],
    ["Hora entrega", (order) => order.delivered_at ? new Date(order.delivered_at).toLocaleTimeString("es-CO") : ""],
    ["Fecha", (order) => order.delivered_at ? new Date(order.delivered_at).toLocaleDateString("es-CO") : ""],
    ["Costo delivery", (order) => order.delivery_fee]
  ];
  const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
  const rows = [
    `<Row>${columns.map(([title]) => `<Cell><Data ss:Type="String">${xmlEscape(title)}</Data></Cell>`).join("")}</Row>`,
    ...reportOrders().map((order) => `<Row>${columns.map(([title, value]) => `<Cell><Data ss:Type="${title === "Costo delivery" ? "Number" : "String"}">${xmlEscape(title === "Motorizado" ? (order.courier?.full_name || order.courier_name || "") : value(order))}</Data></Cell>`).join("")}</Row>`)
  ].join("");
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Entregas"><Table>${rows}</Table></Worksheet></Workbook>`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" }));
  link.download = "reporte-a-un-paso.xls";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function signOut() {
  if (state.profile?.role === "motorizado" && state.profile.online) {
    stopCourierLocationTracking();
    const { error: availabilityError } = await supabase.rpc("set_courier_online", { is_online: false });
    if (availabilityError) console.error("No se pudo cerrar la disponibilidad antes de salir:", availabilityError);
  }
  stopCourierLocationTracking();
  if (state.realtime) {
    await supabase.removeChannel(state.realtime);
    state.realtime = null;
  }
  const { error } = await supabase.auth.signOut();
  if (error) return reportError(error);
  clearInterval(state.refreshTimer);
  state.profile = null;
  state.session = null;
  state.authMode = "login";
  renderAuth();
}

boot();
