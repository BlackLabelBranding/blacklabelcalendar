const state = {
  config: null,
  events: [],
  activeView: "agenda",
  visibleMonth: startOfMonth(new Date()),
};

const DEFAULT_TYPE_RULES = [
  { label: "Rally", tone: "rally", icon: "🏍", match: ["rally", "sturgis", "festival", "fest"] },
  { label: "Band", tone: "entertainment", icon: "🎵", match: ["band", "concert", "music", "show", "dj", "entertainment"] },
  { label: "Meeting", tone: "meeting", icon: "🤝", match: ["meeting", "call", "review", "sync", "appointment"] },
  { label: "Travel", tone: "travel", icon: "✈️", match: ["travel", "flight", "hotel", "drive", "trip", "load in", "load-in"] },
  { label: "Deadline", tone: "deadline", icon: "🔴", match: ["deadline", "due", "launch", "final", "deliver"] },
];

const TYPE_FALLBACKS = {
  rally: { label: "Rally", tone: "rally", icon: "🏍" },
  entertainment: { label: "Band", tone: "entertainment", icon: "🎵" },
  event: { label: "Event", tone: "event", icon: "📅" },
  meeting: { label: "Meeting", tone: "meeting", icon: "🤝" },
  travel: { label: "Travel", tone: "travel", icon: "✈️" },
  deadline: { label: "Deadline", tone: "deadline", icon: "🔴" },
  default: { label: "Event", tone: "event", icon: "📅" },
};

const els = {
  title: document.getElementById("calendarTitle"),
  todayWeekday: document.getElementById("todayWeekday"),
  todayDate: document.getElementById("todayDate"),
  nextEventCard: document.getElementById("nextEventCard"),
  nextEventKicker: document.getElementById("nextEventKicker"),
  nextEventTitle: document.getElementById("nextEventTitle"),
  nextEventTime: document.getElementById("nextEventTime"),
  nextEventLink: document.getElementById("nextEventLink"),
  status: document.getElementById("statusBanner"),
  agenda: document.getElementById("agendaView"),
  today: document.getElementById("todayView"),
  week: document.getElementById("weekView"),
  month: document.getElementById("monthView"),
  googleLink: document.getElementById("googleCalendarLink"),
  refresh: document.getElementById("refreshButton"),
  tabs: Array.from(document.querySelectorAll("[data-view]")),
};

init();

async function init() {
  setTodayHeader();
  bindEvents();
  await loadCalendar();
}

function bindEvents() {
  els.refresh.addEventListener("click", loadCalendar);
  els.tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
}

async function loadCalendar() {
  setStatus("Syncing calendar...", true);
  els.refresh.disabled = true;

  try {
    state.config = await fetchConfig();
    els.title.textContent = state.config.calendarTitle || "Calendar";
    if (state.config.calendarUrl) els.googleLink.href = state.config.calendarUrl;

    state.events = await fetchEvents(state.config);

    if (state.events.length) {
      setStatus("", true);
    } else if (!state.config.googleApiKey) {
      setStatus("Google Calendar is set as the source. Add a restricted Calendar API key to show live events here.", false);
    } else {
      setStatus("No public events are visible yet.", false);
    }

    renderAll();
  } catch (error) {
    console.error("[PublicCalendar]", error);
    state.events = [];
    setStatus("Could not load events from Google Calendar. Check the calendar ID, public visibility, and API key restrictions.", false);
    renderAll();
  } finally {
    els.refresh.disabled = false;
  }
}

async function fetchConfig() {
  const response = await fetch(`./calendar.config.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Calendar config could not be loaded.");
  return response.json();
}

async function fetchEvents(config) {
  if (!config.calendarId || !config.googleApiKey) {
    return config.showDemoEventsWhenUnconfigured === false ? [] : demoEvents();
  }

  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + Number(config.lookaheadDays || 120));

  const params = new URLSearchParams({
    key: config.googleApiKey,
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    maxResults: "250",
  });

  const calendarId = encodeURIComponent(config.calendarId);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Google Calendar returned an error.");

  const payload = await response.json();
  return (payload.items || []).map((item) => normalizeGoogleEvent(item, config)).filter(Boolean);
}

function normalizeGoogleEvent(item, config) {
  const startValue = item.start?.dateTime || item.start?.date;
  const endValue = item.end?.dateTime || item.end?.date;
  if (!startValue) return null;

  const allDay = Boolean(item.start?.date);
  const start = parseGoogleDate(startValue, allDay);
  const end = endValue ? parseGoogleDate(endValue, allDay) : start;
  const type = classifyEvent(item.summary || "", config.eventTypeRules || []);

  return {
    id: item.id,
    title: item.summary || "Untitled event",
    location: item.location || "",
    description: stripHtml(item.description || ""),
    htmlLink: item.htmlLink || config.calendarUrl || "",
    start,
    end,
    allDay,
    label: type.label,
    tone: type.tone,
    icon: type.icon,
  };
}

function parseGoogleDate(value, allDay) {
  return allDay ? new Date(`${value}T00:00:00`) : new Date(value);
}

function classifyEvent(title, rules) {
  const haystack = title.toLowerCase();
  const normalizedRules = [...rules, ...DEFAULT_TYPE_RULES];
  const match = normalizedRules.find((rule) =>
    (rule.match || []).some((term) => haystack.includes(String(term).toLowerCase()))
  );

  if (!match) return TYPE_FALLBACKS.default;
  const tone = match.tone || "event";
  const fallback = TYPE_FALLBACKS[tone] || TYPE_FALLBACKS.default;
  return {
    label: match.label || fallback.label,
    tone,
    icon: match.icon || fallback.icon,
  };
}

function renderAll() {
  const upcoming = state.events.filter((event) => event.end >= startOfDay(new Date()));
  renderNextEvent(upcoming[0]);
  renderAgenda(els.agenda, upcoming, "No upcoming events are visible yet.");
  renderAgenda(els.today, eventsForDay(upcoming, new Date()), "Nothing is scheduled today.");
  renderWeek(upcoming);
  renderMonth();
  setView(state.activeView);
}

function renderNextEvent(event) {
  if (!event) {
    els.nextEventCard.dataset.urgency = "empty";
    els.nextEventKicker.textContent = "Next event";
    els.nextEventTitle.textContent = "No upcoming events";
    els.nextEventTime.textContent = state.config?.timezone || "America/Chicago";
    els.nextEventLink.href = state.config?.calendarUrl || "https://calendar.google.com/";
    return;
  }

  const now = new Date();
  const msUntilStart = event.start.getTime() - now.getTime();
  const within24Hours = msUntilStart > 0 && msUntilStart <= 24 * 60 * 60 * 1000;
  const happeningNow = event.start <= now && event.end >= now;

  els.nextEventCard.dataset.urgency = within24Hours || happeningNow ? "soon" : "normal";
  els.nextEventKicker.textContent = happeningNow ? "🔥 Now happening" : within24Hours ? "🔥 Happening next" : nextEventKicker(event.start);
  els.nextEventTitle.textContent = `${event.icon || "📅"} ${event.title}`;
  els.nextEventTime.textContent = heroTimeLine(event, now);
  els.nextEventLink.href = event.htmlLink || state.config?.calendarUrl || "https://calendar.google.com/";
}

function heroTimeLine(event, now) {
  if (event.start <= now && event.end >= now) return "Open now - event is in progress";
  const countdown = countdownText(event.start, now);
  const date = event.allDay ? formatDate(event.start) : `${formatDate(event.start)} at ${formatTime(event.start)}`;
  return countdown ? `${date} - Starts in ${countdown}` : date;
}

function nextEventKicker(date) {
  const today = startOfDay(new Date());
  const eventDay = startOfDay(date);
  const diffDays = Math.round((eventDay - today) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return "This week";
  if (diffDays <= 31) return "Coming up";
  return "Next event";
}

function countdownText(date, now = new Date()) {
  const diff = Math.max(date.getTime() - now.getTime(), 0);
  if (!diff) return "";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days} ${plural(days, "DAY")} ${hours} ${plural(hours, "HOUR")}`;
  if (hours > 0) return `${hours} ${plural(hours, "HOUR")} ${minutes} ${plural(minutes, "MINUTE")}`;
  return `${Math.max(minutes, 1)} ${plural(Math.max(minutes, 1), "MINUTE")}`;
}

function plural(value, label) {
  return value === 1 ? label : `${label}S`;
}

function renderAgenda(container, events, emptyText) {
  container.innerHTML = "";
  if (!events.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }

  groupByDay(events).forEach(({ day, items }) => {
    const group = document.createElement("section");
    group.className = "day-group";
    group.innerHTML = `<div class="day-label">${escapeHtml(formatDayLabel(day))}</div>`;
    items.forEach((event) => group.appendChild(renderEventCard(event)));
    container.appendChild(group);
  });
}

function renderEventCard(event) {
  const card = document.createElement("details");
  card.className = "event-card";
  card.dataset.tone = event.tone || "default";

  const calendarHref = event.htmlLink || state.config?.calendarUrl || "";
  const mapsHref = event.location ? mapsSearchUrl(event.location) : "";
  const directionsHref = event.location ? directionsUrl(event.location) : "";
  const details = [
    event.description ? `<div class="event-description">${escapeHtml(event.description)}</div>` : "",
    buildEventActions({ calendarHref, mapsHref, directionsHref }),
  ].filter(Boolean).join("");
  const clock = formatClockParts(event.start);

  card.innerHTML = `
    <summary>
      <div class="event-time">
        <strong>${escapeHtml(event.allDay ? "All" : clock.time)}</strong>
        <span>${escapeHtml(event.allDay ? "Day" : clock.period)}</span>
      </div>
      <div class="event-main">
        <div class="event-title-row">
          <h2 class="event-title">${escapeHtml(event.title)}</h2>
          <span class="event-chip">${escapeHtml(event.icon || "📅")} ${escapeHtml(event.label)}</span>
        </div>
        <div class="event-meta">${escapeHtml(event.allDay ? formatDate(event.start) : `${formatDate(event.start)} - ${formatRange(event)}`)}</div>
        ${event.location ? `<div class="event-location">${escapeHtml(event.location)}</div>` : ""}
      </div>
    </summary>
    ${details ? `<div class="event-details">${details}</div>` : ""}
  `;

  return card;
}

function buildEventActions({ calendarHref, mapsHref, directionsHref }) {
  const actions = [
    mapsHref ? `<a href="${escapeAttr(mapsHref)}" target="_blank" rel="noopener noreferrer">Google Maps</a>` : "",
    directionsHref ? `<a href="${escapeAttr(directionsHref)}" target="_blank" rel="noopener noreferrer">Directions</a>` : "",
    calendarHref ? `<a href="${escapeAttr(calendarHref)}" target="_blank" rel="noopener noreferrer">Open in Google Calendar</a>` : "",
  ].filter(Boolean);

  return actions.length ? `<div class="event-actions">${actions.join("")}</div>` : "";
}

function mapsSearchUrl(location) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function directionsUrl(location) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location)}`;
}

function renderWeek(events) {
  const start = startOfWeek(new Date());
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  els.week.innerHTML = `<div class="week-panel">${days.map((day) => renderWeekDay(day, events)).join("")}</div>`;
}

function renderWeekDay(day, events) {
  const items = eventsForDay(events, day);
  const isToday = dateKey(day) === dateKey(new Date());
  return `
    <section class="week-day ${isToday ? "is-today" : ""}">
      <div class="week-date">
        <span>${escapeHtml(day.toLocaleDateString(undefined, { weekday: "short" }))}</span>
        <strong>${day.getDate()}</strong>
      </div>
      <div class="week-events">
        ${items.length ? items.map(renderWeekEvent).join("") : `<p>No events</p>`}
      </div>
    </section>
  `;
}

function renderWeekEvent(event) {
  return `
    <a class="week-event" data-tone="${escapeAttr(event.tone)}" href="${escapeAttr(event.htmlLink || state.config?.calendarUrl || "#")}" target="_blank" rel="noopener noreferrer">
      <strong>${escapeHtml(event.icon || "📅")} ${escapeHtml(event.title)}</strong>
      <span>${escapeHtml(event.allDay ? "All day" : formatTime(event.start))}</span>
    </a>
  `;
}

function renderMonth() {
  const month = state.visibleMonth;
  const firstGridDay = startOfWeek(startOfMonth(month));
  const days = Array.from({ length: 42 }, (_, index) => addDays(firstGridDay, index));
  const monthName = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  els.month.innerHTML = `
    <div class="month-panel">
      <div class="month-header">
        <h2>${escapeHtml(monthName)}</h2>
        <div class="month-controls">
          <button type="button" data-month="prev" aria-label="Previous month">‹</button>
          <button type="button" data-month="next" aria-label="Next month">›</button>
        </div>
      </div>
      <div class="month-grid">
        ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="month-day-name">${day}</div>`).join("")}
        ${days.map((day) => renderMonthCell(day, month)).join("")}
      </div>
    </div>
  `;

  els.month.querySelector('[data-month="prev"]').addEventListener("click", () => changeMonth(-1));
  els.month.querySelector('[data-month="next"]').addEventListener("click", () => changeMonth(1));
}

function renderMonthCell(day, visibleMonth) {
  const items = eventsForDay(state.events, day);
  const visibleItems = items.slice(0, 2);
  const hiddenItems = items.slice(2);
  const classes = ["month-cell"];
  if (day.getMonth() !== visibleMonth.getMonth()) classes.push("is-muted");
  if (dateKey(day) === dateKey(new Date())) classes.push("is-today");

  if (!hiddenItems.length) {
    return `
      <div class="${classes.join(" ")}">
        <span class="month-date">${day.getDate()}</span>
        <div class="month-events">
          ${visibleItems.map(renderMonthEvent).join("")}
        </div>
      </div>
    `;
  }

  return `
    <details class="${classes.join(" ")}">
      <summary>
        <span class="month-date">${day.getDate()}</span>
        <div class="month-events">
          ${visibleItems.map(renderMonthEvent).join("")}
          <span class="month-more">+${hiddenItems.length} more</span>
        </div>
      </summary>
      <div class="month-extra-events">
        ${hiddenItems.map(renderMonthEvent).join("")}
      </div>
    </details>
  `;
}

function renderMonthEvent(event) {
  return `
    <a class="month-event" data-tone="${escapeAttr(event.tone)}" href="${escapeAttr(event.htmlLink || state.config?.calendarUrl || "#")}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(event.title)}">
      <span>${escapeHtml(event.allDay ? "All" : formatTime(event.start))}</span>
      <strong>${escapeHtml(event.icon || "📅")} ${escapeHtml(event.title)}</strong>
    </a>
  `;
}

function setView(view) {
  state.activeView = view;
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  els.agenda.hidden = view !== "agenda";
  els.today.hidden = view !== "today";
  els.week.hidden = view !== "week";
  els.month.hidden = view !== "month";
}

function changeMonth(offset) {
  state.visibleMonth = new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth() + offset, 1);
  renderMonth();
}

function setStatus(message, hidden) {
  els.status.hidden = hidden || !message;
  els.status.textContent = message || "";
}

function setTodayHeader() {
  const now = new Date();
  els.todayWeekday.textContent = now.toLocaleDateString(undefined, { weekday: "long" });
  els.todayDate.textContent = String(now.getDate());
}

function groupByDay(events) {
  const map = new Map();
  events.forEach((event) => {
    const key = dateKey(event.start);
    if (!map.has(key)) map.set(key, { day: startOfDay(event.start), items: [] });
    map.get(key).items.push(event);
  });
  return Array.from(map.values());
}

function eventsForDay(events, day) {
  const key = dateKey(day);
  return events.filter((event) => dateKey(event.start) === key);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date) {
  return addDays(date, -date.getDay());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatDayLabel(date) {
  const today = dateKey(date) === dateKey(new Date()) ? "Today - " : "";
  return `${today}${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`;
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatClockParts(date) {
  const value = formatTime(date);
  const match = value.match(/^(.+?)\s?(AM|PM)$/i);
  if (!match) return { time: value, period: "" };
  return { time: match[1], period: match[2].toUpperCase() };
}

function timePeriod(date) {
  return formatClockParts(date).period;
}

function formatRange(event) {
  if (!event.end || dateKey(event.start) !== dateKey(event.end)) return formatTime(event.start);
  return `${formatTime(event.start)}-${formatTime(event.end)}`;
}

function stripHtml(value) {
  const div = document.createElement("div");
  div.innerHTML = value;
  return div.textContent || div.innerText || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function demoEvents() {
  const now = new Date();
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0);
  const tomorrow = addDays(todayNoon, 1);
  const weekend = addDays(todayNoon, 5);

  return [
    {
      id: "demo-1",
      title: "Brand Calendar Review",
      location: "Black Label HQ",
      description: "Connect the public Google Calendar feed to replace these demo events.",
      start: todayNoon,
      end: new Date(todayNoon.getTime() + 45 * 60 * 1000),
      allDay: false,
      label: "Meeting",
      tone: "meeting",
      icon: "🤝",
    },
    {
      id: "demo-2",
      title: "Josh Holland Band",
      location: "Effingham, IL",
      description: "Example entertainment event with maps and calendar actions.",
      start: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 18, 30),
      end: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 22, 0),
      allDay: false,
      label: "Band",
      tone: "entertainment",
      icon: "🎵",
    },
    {
      id: "demo-3",
      title: "Sturgis Motorcycle Rally",
      location: "Sturgis, SD",
      description: "Rally-style event category example.",
      start: weekend,
      end: weekend,
      allDay: true,
      label: "Rally",
      tone: "rally",
      icon: "🏍",
    },
  ];
}
