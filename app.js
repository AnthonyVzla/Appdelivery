import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ibclzcikkxhdnorcbfoe.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImliY2x6Y2lra3hoZG5vcmNiZm9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NTUwNTEsImV4cCI6MjEwODAzMTA1MX0.FU_CgXhXloA4le2KfBRc0bCIXjewuJ8zr7JxUJLcKJk";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");
const roleNames = { motorizado: "Motorizado", soporte: "Soporte", administracion: "Administración" };
const statusNames = { pending: "Disponible", assigned: "Asignado", at_store: "En el comercio", in_transit: "En camino", delivered: "Entregado" };
const state = { session: null, profile: null, screen: "inicio", orders: [], allies: [], profiles: [], period: "day", authMode: "login", toastTimer: null, refreshTimer: null, realtime: null };

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value || 0));
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
      state.session = null;
      state.profile = null;
      renderAuth();
    }
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.error("No se pudo registrar el service worker:", error));
  }
}

async function loadProfile() {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle();
  if (error) return reportError(error);
  if (!data) {
    showToast("No se encontró el perfil. Contacta a administración.", true);
    await supabase.auth.signOut();
    return;
  }
  state.profile = data;
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
  startRealtime();
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(async () => {
    if (state.profile.role === "motorizado" && state.profile.online) {
      const { error: heartbeatError } = await supabase.rpc("heartbeat_courier");
      if (heartbeatError) console.error("No se pudo actualizar la actividad del motorizado:", heartbeatError);
    }
    await refreshData(true);
  }, 18000);
}

function startRealtime() {
  if (state.realtime) supabase.removeChannel(state.realtime);
  const channel = supabase.channel(`updates-${state.profile.id}`);
  if (state.profile.role === "motorizado") {
    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `courier_id=eq.${state.profile.id}` }, async () => {
      await refreshData(true);
      renderApp();
    });
  } else {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async () => {
      await refreshData(true);
      renderApp();
    }).on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, async () => {
      await refreshData(true);
      renderApp();
    });
  }
  state.realtime = channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.error(`Supabase Realtime: ${status}`);
  });
}

function renderAuth() {
  const isRegister = state.authMode === "register";
  app.innerHTML = `
    <section class="auth-shell"><div class="auth-card">
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
    </div></section>`;
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
  app.innerHTML = `<section class="auth-shell"><div class="auth-card">
    <img class="brand-logo" src="./images (1).png" alt="A un paso delivery">
    <p class="eyebrow">A UN PASO DELIVERY</p><h1>${suspended ? "Cuenta suspendida" : "Solicitud recibida"}</h1>
    <p class="muted">${suspended ? "Tu acceso está suspendido. Comunícate con administración." : "Tu cuenta aún no está habilitada. Podrás ingresar cuando administración apruebe tu usuario y asigne un rol."}</p>
    <button class="button subtle full" id="logout-button">Cerrar sesión</button>
  </div></section>`;
  document.querySelector("#logout-button").addEventListener("click", signOut);
}

async function refreshData(quiet) {
  if (!state.profile || !state.session) return;
  const { data: orders, error: orderError } = await supabase.from("orders")
    .select("*, allies(name), courier:profiles!orders_courier_id_fkey(full_name, username, phone), creator:profiles!orders_created_by_fkey(full_name)")
    .order("created_at", { ascending: false }).limit(500);
  if (orderError) {
    if (!quiet) reportError(orderError);
    return;
  }
  const previousCouriers = new Map(state.orders.map((order) => [order.id, order.courier_id]));
  state.orders = orders || [];
  if (quiet && state.profile.role === "motorizado") {
    const newAssignments = state.orders.filter((order) => order.courier_id === state.profile.id && order.status !== "delivered" && previousCouriers.get(order.id) !== state.profile.id);
    if (newAssignments.length) showToast(newAssignments.length === 1 ? "Tienes un pedido asignado." : `Tienes ${newAssignments.length} pedidos asignados.`);
  }
  if (["administracion", "soporte"].includes(state.profile.role)) {
    const [allyResult, profileResult] = await Promise.all([
      supabase.from("allies").select("*").order("name"),
      supabase.from("profiles").select("id, username, full_name, phone, role, approved, suspended, online, last_seen_at, updated_at").order("full_name")
    ]);
    if (allyResult.error || profileResult.error) {
      if (!quiet) reportError(allyResult.error || profileResult.error);
      return;
    }
    state.allies = allyResult.data || [];
    state.profiles = profileResult.data || [];
  }
  if (quiet) renderApp();
}

const navItems = {
  motorizado: [["inicio", "Resumen"], ["activos", "Pedidos activos"], ["curso", "Pedido en curso"], ["entregados", "Entregados"]],
  soporte: [["inicio", "Resumen"], ["crear", "Crear pedido"], ["pedidos", "Pedidos"], ["entregados", "Finalizados"], ["aliados", "Aliados"]],
  administracion: [["inicio", "Resumen"], ["pedidos", "Pedidos"], ["entregados", "Finalizados"], ["usuarios", "Usuarios"], ["aliados", "Aliados"], ["reportes", "Reportes"], ["metricas", "Métricas"]]
};

function renderApp() {
  if (!state.profile?.role) return renderPending();
  const items = navItems[state.profile.role] || [];
  if (!items.some(([key]) => key === state.screen)) state.screen = "inicio";
  const nav = items.map(([key, label]) => `<button class="nav-button ${state.screen === key ? "active" : ""}" data-screen="${key}">${label}</button>`).join("");
  app.innerHTML = `<div class="layout">
    <aside class="sidebar">
      <div class="sidebar-brand"><img src="./images (1).png" alt=""><div><strong>A un paso<br>delivery</strong><span>${roleNames[state.profile.role]}</span></div></div>
      <nav class="nav-list">${nav}</nav>
      <div class="sidebar-bottom"><div class="user-summary"><strong>${escapeHtml(state.profile.full_name)}</strong><span>@${escapeHtml(state.profile.username)} · ${roleNames[state.profile.role]}</span></div><button class="button subtle full" data-action="logout">Cerrar sesión</button></div>
    </aside>
    <main class="main">
      <header class="topbar"><div><div class="mobile-brand"><img src="./images (1).png" alt=""><strong>A un paso delivery</strong></div><h1>${escapeHtml(titleFor(state.screen))}</h1><p>${new Intl.DateTimeFormat("es-CO", { dateStyle: "full" }).format(new Date())}</p></div>
        ${state.profile.role === "motorizado" ? `<label class="switch-row"><span class="muted">${state.profile.online ? "Activo" : "Desconectado"}</span><span class="switch"><input type="checkbox" data-action="online" ${state.profile.online ? "checked" : ""} aria-label="Disponibilidad"><span></span></span></label>` : `<span class="badge green">${countOnline()} motorizados activos</span>`}
      </header>
      <section id="screen-content">${renderScreen()}</section>
    </main>
    <nav class="mobile-nav">${nav}</nav>
  </div>`;
  app.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => {
    state.screen = button.dataset.screen;
    renderApp();
  }));
  app.querySelectorAll('[data-action="logout"]').forEach((button) => button.addEventListener("click", signOut));
  const onlineToggle = app.querySelector('[data-action="online"]');
  if (onlineToggle) onlineToggle.addEventListener("change", toggleOnline);
  bindScreenActions();
}

function titleFor(screen) {
  return ({ inicio: "Resumen", activos: "Pedidos activos", curso: "Pedido en curso", entregados: "Pedidos entregados", crear: "Crear pedido", pedidos: "Pedidos", aliados: "Aliados", usuarios: "Usuarios", reportes: "Reportes", metricas: "Métricas" })[screen] || "A un paso delivery";
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
  if (state.screen === "inicio") return renderDashboard();
  if (state.screen === "crear" && role === "soporte") return renderCreateOrder();
  if (state.screen === "activos" && role === "motorizado") return renderCourierAvailable();
  if (state.screen === "curso" && role === "motorizado") return renderCourierCurrent();
  if (state.screen === "pedidos" && role !== "motorizado") return renderStaffOrders();
  if (state.screen === "entregados") return role === "motorizado" ? renderCourierDelivered() : renderCompletedOrders();
  if (state.screen === "aliados" && role !== "motorizado") return renderAllies();
  if (state.screen === "usuarios" && role === "administracion") return renderUsers();
  if ((state.screen === "reportes" || state.screen === "metricas") && role === "administracion") return renderReports();
  return `<div class="empty">Selecciona una sección.</div>`;
}

function renderDashboard() {
  const role = state.profile.role;
  const today = dayStart();
  const createdToday = state.orders.filter((order) => new Date(order.created_at) >= today && (role !== "motorizado" || order.courier_id === state.profile.id));
  const completed = state.orders.filter((order) => order.status === "delivered" && new Date(order.delivered_at) >= today);
  const revenue = completed.reduce((sum, order) => sum + Number(order.delivery_fee), 0);
  const activeOrders = state.orders.filter((order) => order.status !== "delivered");
  return `<div class="grid metrics">
    <article class="card"><span class="metric-label">Pedidos creados hoy</span><div class="metric-value">${createdToday.length}</div><span class="metric-foot">${completed.length} entregas finalizadas</span></article>
    <article class="card"><span class="metric-label">Delivery generado hoy</span><div class="metric-value">${formatMoney(revenue)}</div><span class="metric-foot">Suma de costos de delivery</span></article>
    <article class="card"><span class="metric-label">Motorizados activos</span><div class="metric-value">${role === "motorizado" ? (state.profile.online ? "1" : "0") : countOnline()}</div><span class="metric-foot">Disponibles en este momento</span></article>
  </div>
  <div class="section-head"><h2>${role === "motorizado" ? "Tus entregas activas" : "Pedidos en curso"}</h2></div>
  <div class="list">${renderOrderCards(activeOrders.filter((order) => role !== "motorizado" || order.courier_id === state.profile.id).slice(0, 5), "dashboard")}</div>`;
}

function statusBadge(status) {
  const color = status === "delivered" ? "green" : status === "pending" ? "gray" : status === "in_transit" ? "orange" : "";
  return `<span class="badge ${color}">${statusNames[status] || status}</span>`;
}

function renderOrderCards(orders, context = "") {
  if (!orders.length) return `<div class="empty">No hay pedidos para mostrar.</div>`;
  return orders.map((order) => {
    const ally = escapeHtml(order.allies?.name || "Aliado");
    const courier = escapeHtml(order.courier?.full_name || "Sin asignar");
    const buttons = [];
    if (context === "available") buttons.push(`<button class="button primary small" data-action="claim" data-id="${order.id}">Tomar pedido</button>`);
    if (context === "current") {
      const next = { assigned: ["at_store", "Llegada al comercio"], at_store: ["in_transit", "Pedido en camino"], in_transit: ["delivered", "Pedido entregado"] }[order.status];
      if (next) buttons.push(`<button class="button ${next[0] === "delivered" ? "success" : "primary"} small" data-action="advance" data-status="${next[0]}" data-id="${order.id}">${next[1]}</button>`);
      buttons.push(`<button class="button subtle small" data-action="maps" data-url="${escapeHtml(order.maps_url || "")}">Abrir ubicación</button>`);
    }
    if (context === "staff" && ["administracion", "soporte"].includes(state.profile.role) && order.status !== "delivered") {
      buttons.push(`<label class="assign-control">Asignar motorizado<select data-action="assign" data-id="${order.id}"><option value="">${order.courier_id ? "Cambiar asignación…" : "Seleccionar…"}</option>${state.profiles.filter((profile) => profile.role === "motorizado" && profile.approved && !profile.suspended).map((profile) => `<option value="${profile.id}" ${profile.id === order.courier_id ? "selected" : ""}>${escapeHtml(profile.full_name)}</option>`).join("")}</select></label>`);
    }
    return `<article class="order-card"><div class="order-top"><div><h3>${ally} <span class="muted">· ${escapeHtml(order.client_name)}</span></h3><p>Pedido #${order.id.slice(0, 8)} · ${dateTime(order.created_at)}</p></div>${statusBadge(order.status)}</div>
      <p class="order-detail"><strong>Cliente:</strong> ${escapeHtml(order.client_name)} · ${escapeHtml(order.client_phone)}<br><strong>Dirección:</strong> ${escapeHtml(order.address)}<br><strong>Motorizado:</strong> ${courier === "Sin asignar" ? escapeHtml(order.courier_name || courier) : courier}${context === "completed" ? `<br><strong>Recogida en comercio:</strong> ${dateTime(order.at_store_at)}<br><strong>Entrega:</strong> ${dateTime(order.delivered_at)}` : ""}<br><strong>Delivery:</strong> ${formatMoney(order.delivery_fee)}</p>
      ${buttons.length ? `<div class="order-actions">${buttons.join("")}</div>` : ""}</article>`;
  }).join("");
}

function renderCourierAvailable() {
  const orders = state.orders.filter((order) => order.status === "pending");
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
  const amount = orders.reduce((sum, order) => sum + Number(order.delivery_fee), 0);
  return `<div class="grid metrics"><article class="card"><span class="metric-label">Pedidos en el periodo</span><div class="metric-value">${orders.length}</div></article><article class="card"><span class="metric-label">Dinero generado</span><div class="metric-value">${formatMoney(amount)}</div></article><article class="card"><span class="metric-label">Total de hoy</span><div class="metric-value">${formatMoney(filteredToday().reduce((sum, order) => sum + Number(order.delivery_fee), 0))}</div></article></div><div class="section-head"><h2>Historial de entregas</h2></div><div class="list">${renderOrderCards(orders, "completed")}</div>`;
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
  return `<article class="card form-card"><form id="create-order" class="form-grid">
    <label>Aliado comercial<select name="allyId" required><option value="">Selecciona un aliado</option>${state.allies.map((ally) => `<option value="${ally.id}">${escapeHtml(ally.name)}</option>`).join("")}</select></label>
    <label>Nombre del cliente<input name="clientName" required></label>
    <label>Teléfono del cliente<input name="clientPhone" type="tel" required></label>
    <label>Precio del delivery<input name="deliveryFee" type="number" min="0" step="100" required></label>
    <label class="wide">Dirección escrita<textarea name="address" required></textarea></label>
    <label class="wide">Ubicación de Google Maps (URL)<input name="mapsUrl" type="url" placeholder="https://maps.google.com/..." required></label>
    <div class="wide"><button class="button primary" type="submit">Crear pedido</button></div>
  </form></article>`;
}

function renderAllies() {
  const isAdmin = state.profile.role === "administracion";
  return `<div class="section-head"><h2>Aliados comerciales</h2></div>${isAdmin ? `<form id="ally-form" class="toolbar"><label>Nombre del aliado<input name="name" required></label><button class="button primary">Agregar aliado</button></form>` : ""}
    <div class="list">${state.allies.length ? state.allies.map((ally) => `<article class="card order-top"><div><h3>${escapeHtml(ally.name)}</h3><p class="muted">Creado ${dateTime(ally.created_at)}</p></div>${isAdmin ? `<button class="button danger small" data-action="delete-ally" data-id="${ally.id}">Eliminar</button>` : ""}</article>`).join("") : `<div class="empty">Aún no hay aliados registrados.</div>`}</div>`;
}

function renderUsers() {
  return `<div class="section-head"><h2>Usuarios y permisos</h2></div><div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Nombre y teléfono</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${state.profiles.map((profile) => `<tr><td>@${escapeHtml(profile.username)}</td><td><input aria-label="Nombre completo" data-profile-name="${profile.id}" value="${escapeHtml(profile.full_name)}"><input aria-label="Teléfono" data-profile-phone="${profile.id}" value="${escapeHtml(profile.phone || "")}" style="margin-top:6px"></td><td><select data-action="role" data-id="${profile.id}"><option value="">Sin rol</option>${Object.entries(roleNames).map(([value, label]) => `<option value="${value}" ${profile.role === value ? "selected" : ""}>${label}</option>`).join("")}</select></td><td>${profile.suspended ? `<span class="badge">Suspendido</span>` : profile.approved ? `<span class="badge green">${profile.online ? "Activo" : "Aprobado"}</span>` : `<span class="badge orange">Pendiente</span>`}</td><td class="user-actions"><button class="button subtle small" data-action="save-profile" data-id="${profile.id}">Guardar</button><button class="button ${profile.suspended ? "success" : "danger"} small" data-action="suspend" data-id="${profile.id}" data-suspended="${profile.suspended}">${profile.suspended ? "Reactivar" : "Suspender"}</button><button class="button danger small" data-action="delete-user" data-id="${profile.id}">Eliminar</button></td></tr>`).join("")}</tbody></table></div><p class="fine-print">Eliminar una cuenta borra su acceso de inicio de sesión. Los pedidos quedan en el historial con el nombre del motorizado.</p>`;
}

function renderReports() {
  const delivered = state.orders.filter((order) => order.status === "delivered");
  const todayDelivered = delivered.filter((order) => new Date(order.delivered_at) >= dayStart());
  const createdToday = state.orders.filter((order) => new Date(order.created_at) >= dayStart());
  return `<div class="grid metrics"><article class="card"><span class="metric-label">Pedidos creados hoy</span><div class="metric-value">${createdToday.length}</div><span class="metric-foot">${todayDelivered.length} entregados</span></article><article class="card"><span class="metric-label">Delivery generado hoy</span><div class="metric-value">${formatMoney(todayDelivered.reduce((sum, order) => sum + Number(order.delivery_fee), 0))}</div></article><article class="card"><span class="metric-label">Motorizados activos</span><div class="metric-value">${countOnline()}</div></article></div>
    <div class="section-head"><h2>Reportes de entregas</h2></div><div class="toolbar"><label>Desde<input type="date" id="report-from"></label><label>Hasta<input type="date" id="report-to"></label><button class="button primary" data-action="export">Descargar reporte Excel</button></div>
    <div id="report-table" class="table-wrap">${reportTable(delivered)}</div>`;
}

function reportTable(orders) {
  return `<table><thead><tr><th>Aliado</th><th>Cliente</th><th>Dirección</th><th>Motorizado</th><th>Hora comercio</th><th>Hora entrega</th><th>Fecha</th><th>Delivery</th></tr></thead><tbody>${orders.length ? orders.map((order) => `<tr><td>${escapeHtml(order.allies?.name)}</td><td>${escapeHtml(order.client_name)}</td><td>${escapeHtml(order.address)}</td><td>${escapeHtml(order.courier?.full_name || order.courier_name || "")}</td><td>${dateTime(order.at_store_at)}</td><td>${dateTime(order.delivered_at)}</td><td>${new Date(order.delivered_at).toLocaleDateString("es-CO")}</td><td>${formatMoney(order.delivery_fee)}</td></tr>`).join("") : `<tr><td colspan="8">Sin pedidos para el periodo seleccionado.</td></tr>`}</tbody></table>`;
}

function reportOrders() {
  const from = document.querySelector("#report-from")?.value;
  const to = document.querySelector("#report-to")?.value;
  return state.orders.filter((order) => order.status === "delivered" && (!from || new Date(order.delivered_at) >= new Date(`${from}T00:00:00`)) && (!to || new Date(order.delivered_at) < new Date(`${to}T23:59:59.999`)));
}

function bindScreenActions() {
  const createForm = document.querySelector("#create-order");
  if (createForm) createForm.addEventListener("submit", createOrder);
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
  document.querySelectorAll("#report-from, #report-to").forEach((input) => input.addEventListener("change", () => {
    document.querySelector("#report-table").innerHTML = reportTable(reportOrders());
  }));
  bindOrderActions();
}

function deliveredSummaryFor(orders) {
  const amount = orders.reduce((sum, order) => sum + Number(order.delivery_fee), 0);
  return `<div class="grid metrics"><article class="card"><span class="metric-label">Pedidos en el periodo</span><div class="metric-value">${orders.length}</div></article><article class="card"><span class="metric-label">Dinero generado</span><div class="metric-value">${formatMoney(amount)}</div></article><article class="card"><span class="metric-label">Total de hoy</span><div class="metric-value">${formatMoney(filteredToday().reduce((sum, order) => sum + Number(order.delivery_fee), 0))}</div></article></div><div class="section-head"><h2>Historial de entregas</h2></div><div class="list">${renderOrderCards(orders, "completed")}</div>`;
}

function bindOrderActions() {
  document.querySelectorAll('[data-action="claim"]').forEach((button) => button.addEventListener("click", () => updateOrder(button.dataset.id, "claim_order")));
  document.querySelectorAll('[data-action="advance"]').forEach((button) => button.addEventListener("click", () => updateOrder(button.dataset.id, "advance_order", { next_status: button.dataset.status })));
  document.querySelectorAll('[data-action="assign"]').forEach((select) => select.addEventListener("change", () => {
    if (select.value) updateOrder(select.dataset.id, "assign_order", { target_courier: select.value });
  }));
  document.querySelectorAll('[data-action="maps"]').forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.url) window.open(button.dataset.url, "_blank", "noopener,noreferrer");
  }));
  document.querySelectorAll('[data-action="role"]').forEach((select) => select.addEventListener("change", () => updateProfile(select.dataset.id, { role: select.value || null, approved: Boolean(select.value) })));
  document.querySelectorAll('[data-action="save-profile"]').forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.id;
    const full_name = document.querySelector(`[data-profile-name="${id}"]`).value.trim();
    const phone = document.querySelector(`[data-profile-phone="${id}"]`).value.trim();
    if (!full_name || !phone) return showToast("Nombre y teléfono son obligatorios.", true);
    updateProfile(id, { full_name, phone });
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
  showToast(online ? "Estás activo y puedes recibir pedidos." : "Quedaste desconectado.");
  await refreshData(true);
}

async function createOrder(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const mapsUrl = String(data.get("mapsUrl")).trim();
  if (!/^https?:\/\/\S+$/i.test(mapsUrl)) return showToast("La ubicación debe ser una URL http o https.", true);
  const { error } = await supabase.from("orders").insert({
    ally_id: data.get("allyId"),
    client_name: String(data.get("clientName")).trim(),
    client_phone: String(data.get("clientPhone")).trim(),
    address: String(data.get("address")).trim(),
    maps_url: mapsUrl,
    delivery_fee: Number(data.get("deliveryFee")),
    created_by: state.profile.id
  });
  if (error) return reportError(error);
  showToast("Pedido creado y disponible para los motorizados.");
  state.screen = "pedidos";
  await refreshData(false);
  renderApp();
}

async function createAlly(event) {
  event.preventDefault();
  const name = new FormData(event.currentTarget).get("name").toString().trim();
  const { error } = await supabase.from("allies").insert({ name });
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
  const { error } = await supabase.rpc(action, { order_id: id, ...args });
  if (error) return reportError(error);
  showToast(action === "claim_order" ? "Pedido asignado a tu cuenta." : action === "assign_order" ? "Pedido asignado al motorizado." : "Estado del pedido actualizado.");
  await refreshData(true);
}

async function updateProfile(id, changes) {
  const { error } = await supabase.from("profiles").update(changes).eq("id", id);
  if (error) return reportError(error);
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
