// ---------------------------------------------------------------------
// Default city shown when the page first loads, unless a saved place
// takes precedence. Search replaces this.
// ---------------------------------------------------------------------
const DEFAULT_CITY_QUERY = "Stockholm";

// ---------------------------------------------------------------------
// Dark mode: defaults to prefers-color-scheme, overridable via the
// toggle button, override persisted in localStorage. The <head> inline
// script applies any stored override before first paint to avoid a
// flash of the wrong theme; this just takes over from there.
// ---------------------------------------------------------------------
const THEME_STORAGE_KEY = "weather-color-scheme";

function readStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null; // localStorage unavailable (private browsing, etc.)
  }
}

function writeStoredTheme(theme) {
  try {
    if (theme) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } else {
      localStorage.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    // Theme just won't persist across reloads.
  }
}

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function effectiveTheme(override) {
  return override || (systemPrefersDark() ? "dark" : "light");
}

function applyTheme(override) {
  if (override) {
    document.documentElement.setAttribute("data-theme", override);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  updateThemeToggleButton(override);
}

function updateThemeToggleButton(override) {
  const button = document.getElementById("theme-toggle");
  const current = effectiveTheme(override);
  const next = current === "dark" ? "light" : "dark";
  button.textContent = current === "dark" ? "Day round" : "Twilight";
  button.setAttribute("aria-label", `Switch to ${next} mode`);
}

function initTheme() {
  let override = readStoredTheme();
  applyTheme(override);

  document.getElementById("theme-toggle").addEventListener("click", () => {
    override = effectiveTheme(override) === "dark" ? "light" : "dark";
    writeStoredTheme(override);
    applyTheme(override);
  });

  // Keep the button label in sync if the system theme changes while no
  // explicit override is set.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!override) {
      updateThemeToggleButton(null);
    }
  });
}

// ---------------------------------------------------------------------
// Saved places ("my courses"). Persisted in localStorage as a list of
// geocoded places, so a saved place can be reloaded straight from its
// coordinates without going through geocoding again.
// ---------------------------------------------------------------------
const SAVED_PLACES_STORAGE_KEY = "weather-saved-places";
const MAX_SAVED_PLACES = 12;

// Coordinates are rounded before being used as an identity, so the same
// course saved from two slightly different geocoding hits doesn't end up
// stored twice.
function placeKey(place) {
  return `${Number(place.latitude).toFixed(3)},${Number(place.longitude).toFixed(3)}`;
}

function readSavedPlaces() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_PLACES_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    // Drop anything that can't be turned back into a forecast request.
    return parsed.filter(
      (p) =>
        p &&
        typeof p.name === "string" &&
        Number.isFinite(Number(p.latitude)) &&
        Number.isFinite(Number(p.longitude))
    );
  } catch {
    return []; // unavailable or corrupted storage — start from empty
  }
}

function writeSavedPlaces(places) {
  try {
    localStorage.setItem(SAVED_PLACES_STORAGE_KEY, JSON.stringify(places));
  } catch {
    // Saved places just won't survive a reload.
  }
}

function isPlaceSaved(place) {
  if (!place) return false;
  const key = placeKey(place);
  return readSavedPlaces().some((p) => placeKey(p) === key);
}

// Store only the fields the app actually needs, so a bulky geocoding
// result doesn't get parked in localStorage wholesale.
function toSavedPlace(place) {
  return {
    name: place.name,
    region: place.region ?? null,
    admin1: place.admin1 ?? null,
    country: place.country ?? null,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

function toggleSavedPlace(place) {
  const key = placeKey(place);
  const places = readSavedPlaces();
  const existing = places.findIndex((p) => placeKey(p) === key);

  if (existing !== -1) {
    places.splice(existing, 1);
  } else {
    places.unshift(toSavedPlace(place));
  }

  writeSavedPlaces(places.slice(0, MAX_SAVED_PLACES));
  renderSavedPlaces();
  return existing === -1; // true when the place is now saved
}

function removeSavedPlace(key) {
  writeSavedPlaces(readSavedPlaces().filter((p) => placeKey(p) !== key));
  renderSavedPlaces();
  // Removing the chip for the place on screen has to un-press its button.
  updateSaveButton(isPlaceSaved(currentPlace));
}

function renderSavedPlaces() {
  const section = document.getElementById("saved-places");
  const list = document.getElementById("saved-list");
  const places = readSavedPlaces();

  section.hidden = places.length === 0;

  list.innerHTML = places
    .map((place) => {
      const key = placeKey(place);
      const region = placeRegion(place);
      const label = region ? `${place.name} — ${region}` : place.name;
      const current = currentPlace && placeKey(currentPlace) === key;
      return `
        <li class="saved-item${current ? " is-current" : ""}">
          <button type="button" class="saved-load" data-key="${escapeHtml(key)}" title="${escapeHtml(label)}">
            ${escapeHtml(place.name)}
          </button>
          <button type="button" class="saved-remove" data-remove-key="${escapeHtml(key)}"
                  aria-label="Remove ${escapeHtml(label)} from saved places">&times;</button>
        </li>
      `;
    })
    .join("");
}

function initSavedPlaces() {
  document.getElementById("saved-list").addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-key]");
    if (removeButton) {
      removeSavedPlace(removeButton.dataset.removeKey);
      return;
    }

    const loadButton = event.target.closest("[data-key]");
    if (!loadButton) return;

    const place = readSavedPlaces().find((p) => placeKey(p) === loadButton.dataset.key);
    if (place) {
      loadPlace(place);
    }
  });

  // The save button lives inside the re-rendered card, so it's handled
  // by delegation from the card itself.
  document.getElementById("weather-card").addEventListener("click", (event) => {
    if (!event.target.closest("#save-place") || !currentPlace) return;
    const nowSaved = toggleSavedPlace(currentPlace);
    updateSaveButton(nowSaved);
  });

  renderSavedPlaces();
}

function updateSaveButton(saved) {
  const button = document.getElementById("save-place");
  if (!button) return;
  button.classList.toggle("is-saved", saved);
  button.setAttribute("aria-pressed", String(saved));
  button.textContent = saved ? "★ Saved" : "☆ Save course";
}

// ---------------------------------------------------------------------
// WMO weather_code -> human-readable description.
// https://open-meteo.com/en/docs (see "WMO Weather interpretation codes")
// ---------------------------------------------------------------------
const WMO_DESCRIPTIONS = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function describeWeatherCode(code) {
  return WMO_DESCRIPTIONS[code] ?? "Unknown conditions";
}

// Convert an API date string like "2026-08-25" into a weekday name
// like "Tue". Built from the parts (not `new Date(dateStr)`) so the
// browser's local timezone can't shift it back a day.
function weekdayFromDateString(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

// Place names come back from the geocoding API and saved places come
// back from localStorage, so neither is trusted straight into innerHTML.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function placeRegion(place) {
  // A place can carry a ready-made region line (the GPS path uses this
  // for its coordinates); otherwise it's built from the geocoding fields.
  if (place.region) return place.region;
  return [place.admin1, place.country].filter(Boolean).join(", ");
}

// Renders a number that the API may have omitted for a given day.
function formatValue(value, unit = "", digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Number(value).toFixed(digits)}${unit}`;
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

function compassFromDegrees(degrees) {
  if (degrees === null || degrees === undefined || Number.isNaN(Number(degrees))) {
    return "—";
  }
  const index = Math.round(Number(degrees) / 22.5) % 16;
  return COMPASS_POINTS[(index + 16) % 16];
}

// Wind matters more on a golf course than anywhere else, so the current
// wind gets a plain-language read on what it means for the round. The
// thresholds are in km/h, the unit Open-Meteo returns by default.
function describeWindForGolf(speed) {
  if (speed === null || speed === undefined || Number.isNaN(Number(speed))) {
    return "Wind data unavailable.";
  }
  const kmh = Number(speed);
  if (kmh < 8) return "Barely a breath — pure scoring conditions.";
  if (kmh < 16) return "Gentle breeze — a club at most into the wind.";
  if (kmh < 29) return "Honest wind — take an extra club and swing easy.";
  if (kmh < 45) return "Strong wind — keep it low and under the gusts.";
  return "Brutal out there — links golf whether you like it or not.";
}

// Same idea for the rain outlook, based on the highest chance of rain
// across the forecast window.
function describeRainForGolf(maxProbability) {
  if (maxProbability === null) return "No rain probability available for this course.";
  if (maxProbability < 20) return "Dry bag weather — leave the rain gear in the car.";
  if (maxProbability < 50) return "A shower is possible — pack the umbrella.";
  if (maxProbability < 80) return "Rain is likely — waterproofs and a dry towel.";
  return "Expect to get wet — cart path only kind of day.";
}

// Thrown when a response comes back with a non-OK HTTP status, so the
// caller can tell that apart from a network failure (fetch throwing)
// or a plain empty result.
class HttpError extends Error {
  constructor(status) {
    super(`Request failed with status ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new HttpError(response.status);
  }
  return response.json();
}

// Look up matching places for a search term. Returns the first result,
// or null if the API found nothing (a miss omits the "results" key
// entirely rather than returning an empty array, so that's checked for).
async function geocodeCity(query) {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;

  const data = await fetchJson(url);
  console.log("Open-Meteo geocoding response:", data);

  if (!data.results || data.results.length === 0) {
    return null;
  }
  return data.results[0];
}

async function fetchForecast(latitude, longitude) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,apparent_temperature,weather_code,` +
    `wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,` +
    `wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,` +
    `precipitation_probability_max,precipitation_sum` +
    `&timezone=auto&forecast_days=5`;

  const data = await fetchJson(url);
  console.log("Open-Meteo forecast response:", data);
  return data;
}

// Reshape the raw Open-Meteo response + matched place into the flat
// shape render() expects. Daily series are read defensively: if a model
// doesn't supply one (precipitation probability in particular is not
// available everywhere), the day falls back to null and renders as "—".
function toRenderData(apiResponse, place) {
  const { current, current_units, daily, daily_units } = apiResponse;

  const dayAt = (series, i) => series?.[i] ?? null;

  const rainDays = daily.time.map((dateStr, i) => ({
    day: weekdayFromDateString(dateStr),
    probability: dayAt(daily.precipitation_probability_max, i),
    amount: dayAt(daily.precipitation_sum, i),
  }));

  const probabilities = rainDays
    .map((d) => d.probability)
    .filter((p) => p !== null && !Number.isNaN(Number(p)))
    .map(Number);

  return {
    city: place.name,
    region: placeRegion(place),
    currentTemp: current.temperature_2m,
    feelsLike: current.apparent_temperature,
    conditions: describeWeatherCode(current.weather_code),
    tempUnit: current_units.temperature_2m,
    lastUpdated: new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
    forecast: daily.time.map((dateStr, i) => ({
      day: weekdayFromDateString(dateStr),
      high: daily.temperature_2m_max[i],
      low: daily.temperature_2m_min[i],
    })),
    wind: {
      speed: current.wind_speed_10m ?? null,
      gusts: current.wind_gusts_10m ?? null,
      direction: current.wind_direction_10m ?? null,
      speedUnit: current_units?.wind_speed_10m ?? "",
      days: daily.time.map((dateStr, i) => ({
        day: weekdayFromDateString(dateStr),
        speed: dayAt(daily.wind_speed_10m_max, i),
        gusts: dayAt(daily.wind_gusts_10m_max, i),
        direction: dayAt(daily.wind_direction_10m_dominant, i),
      })),
      dailyUnit: daily_units?.wind_speed_10m_max ?? "",
    },
    rain: {
      now: current.precipitation ?? null,
      nowUnit: current_units?.precipitation ?? "",
      amountUnit: daily_units?.precipitation_sum ?? "mm",
      maxProbability: probabilities.length ? Math.max(...probabilities) : null,
      days: rainDays,
    },
  };
}

function render(data) {
  const card = document.getElementById("weather-card");

  const forecastHtml = data.forecast
    .map(
      (d) => `
      <div class="forecast-day">
        <span class="forecast-day-name">${d.day}</span>
        <span class="forecast-high">${d.high}${data.tempUnit}</span>
        <span class="forecast-low">${d.low}${data.tempUnit}</span>
      </div>
    `
    )
    .join("");

  const windDaysHtml = data.wind.days
    .map(
      (d) => `
      <div class="strip-day">
        <span class="strip-day-name">${d.day}</span>
        <span class="strip-arrow" style="--dir: ${Number(d.direction) || 0}deg"
              aria-hidden="true">&#8593;</span>
        <span class="strip-primary">${formatValue(d.speed)}</span>
        <span class="strip-secondary">G ${formatValue(d.gusts)}</span>
        <span class="strip-secondary">${compassFromDegrees(d.direction)}</span>
      </div>
    `
    )
    .join("");

  // Bar height is capped at 100% so a day at or above certain rain still
  // fills the gauge rather than overflowing it.
  const rainDaysHtml = data.rain.days
    .map((d) => {
      const probability = d.probability === null ? null : Number(d.probability);
      const height = probability === null ? 0 : Math.max(0, Math.min(100, probability));
      return `
      <div class="strip-day">
        <span class="strip-day-name">${d.day}</span>
        <span class="rain-gauge" aria-hidden="true">
          <span class="rain-gauge-fill" style="height: ${height}%"></span>
        </span>
        <span class="strip-primary">${formatValue(probability, "%")}</span>
        <span class="strip-secondary">${formatValue(d.amount, ` ${data.rain.amountUnit}`, 1)}</span>
      </div>
    `;
    })
    .join("");

  const fallingNow =
    data.rain.now !== null && Number(data.rain.now) > 0
      ? `<p class="section-note">Falling right now: ${formatValue(
          data.rain.now,
          ` ${data.rain.nowUnit}`,
          1
        )}.</p>`
      : "";

  card.innerHTML = `
    <section class="current">
      <h1 class="city">${escapeHtml(data.city)}</h1>
      <p class="region">${escapeHtml(data.region)}</p>
      <p class="temp-now">${data.currentTemp}${data.tempUnit}</p>
      <p class="conditions">${data.conditions}</p>
      <p class="feels-like">Feels like ${data.feelsLike}${data.tempUnit}</p>
      <button type="button" id="save-place" class="save-place" aria-pressed="false">
        &#9734; Save course
      </button>
      <p class="last-updated">Last updated ${data.lastUpdated}</p>
    </section>

    <section class="forecast">
      <h2 class="section-heading">5-Day Outlook</h2>
      <div class="forecast-row">
        ${forecastHtml}
      </div>
    </section>

    <section class="wind">
      <h2 class="section-heading">Wind Forecast</h2>
      <p class="wind-now">
        <span class="wind-now-value">${formatValue(data.wind.speed, ` ${data.wind.speedUnit}`)}</span>
        <span class="wind-now-meta">from ${compassFromDegrees(data.wind.direction)} &middot;
          gusting ${formatValue(data.wind.gusts, ` ${data.wind.speedUnit}`)}</span>
      </p>
      <p class="section-note">${describeWindForGolf(data.wind.speed)}</p>
      <div class="strip-row">
        ${windDaysHtml}
      </div>
      <p class="strip-legend">Daily max wind &middot; G = gusts (${data.wind.dailyUnit})</p>
    </section>

    <section class="rain">
      <h2 class="section-heading">Anticipated Rain</h2>
      <p class="section-note">${describeRainForGolf(data.rain.maxProbability)}</p>
      ${fallingNow}
      <div class="strip-row">
        ${rainDaysHtml}
      </div>
      <p class="strip-legend">Chance of rain &middot; expected total (${data.rain.amountUnit})</p>
    </section>
  `;

  updateSaveButton(isPlaceSaved(currentPlace));
}

function setStatus(message, kind) {
  const el = document.getElementById("search-status");
  el.textContent = message;
  if (kind) {
    el.dataset.kind = kind;
  } else {
    delete el.dataset.kind;
  }
}

function setSearchDisabled(disabled) {
  document.getElementById("search-button").disabled = disabled;
  document.getElementById("city-input").disabled = disabled;
}

function describeError(err) {
  if (err instanceof HttpError) {
    return `Weather service returned an error (status ${err.status}). Please try again.`;
  }
  if (err instanceof TypeError) {
    // fetch() rejects with a TypeError for network-level failures:
    // offline, DNS failure, blocked by CORS, etc.
    return "Network error — check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}

// Guards against out-of-order responses: each call gets an id, and
// after every await it checks whether a newer call has since started.
// If so, this one is stale and bows out without touching the page —
// so a slow response can never overwrite a faster, more recent one.
let latestRequestId = 0;

// The place currently on screen, so it can be saved or un-saved.
let currentPlace = null;

// Loads a place that's already been resolved to coordinates — a saved
// place, or a fresh geocoding hit.
async function loadPlace(place, requestId = ++latestRequestId) {
  setStatus(`Loading conditions for ${place.name}…`, "loading");
  setSearchDisabled(true);

  try {
    const apiResponse = await fetchForecast(place.latitude, place.longitude);
    if (requestId !== latestRequestId) return; // a newer search superseded this one

    currentPlace = place;
    render(toRenderData(apiResponse, place));
    renderSavedPlaces(); // refresh which saved chip is highlighted
    setStatus("", null);
  } catch (err) {
    if (requestId !== latestRequestId) return; // a newer search superseded this one
    console.error(err);
    setStatus(describeError(err), "error");
  } finally {
    if (requestId === latestRequestId) {
      setSearchDisabled(false);
    }
  }
}

async function loadCity(rawQuery) {
  const query = rawQuery.trim();

  if (!query) {
    setStatus("Enter a city name to search.", "error");
    return;
  }

  const requestId = ++latestRequestId;
  setStatus(`Loading weather for "${query}"…`, "loading");
  setSearchDisabled(true);

  try {
    const place = await geocodeCity(query);
    if (requestId !== latestRequestId) return; // a newer search superseded this one

    if (!place) {
      setStatus(`No matching city found for "${query}".`, "error");
      setSearchDisabled(false);
      return;
    }

    // Hand off to loadPlace under the same request id, so the staleness
    // guard still covers the forecast leg of the same search.
    await loadPlace(place, requestId);
  } catch (err) {
    if (requestId !== latestRequestId) return; // a newer search superseded this one
    console.error(err);
    setStatus(describeError(err), "error");
    setSearchDisabled(false);
  }
}

// ---------------------------------------------------------------------
// "Use my location": ask the browser for a GPS fix and load the forecast
// for those coordinates. Geolocation is only available in a secure
// context (HTTPS, or localhost while developing) — on a plain-http host
// the browser reports it as a denial rather than an error, which the
// messages below are worded to survive.
// ---------------------------------------------------------------------
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true, // worth the battery: a course is a big place
  timeout: 10000,
  maximumAge: 60000, // a fix from the last minute is close enough
};

// Rendered as the region line under "My location", so a saved fix can
// still be told apart from one taken at a different course.
function formatCoordinates(latitude, longitude) {
  const lat = `${Math.abs(latitude).toFixed(3)}\u00b0${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(longitude).toFixed(3)}\u00b0${longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}

// GeolocationPositionError codes, spelled out rather than compared
// against the constants, which don't exist when the API is missing.
function describeGeolocationError(err) {
  switch (err?.code) {
    case 1: // PERMISSION_DENIED
      return "Location permission denied — search for the course instead.";
    case 2: // POSITION_UNAVAILABLE
      return "Couldn't get a position fix. Try again out in the open.";
    case 3: // TIMEOUT
      return "Location timed out. Try again with a clear view of the sky.";
    default:
      return "Couldn't read your location. Search for the course instead.";
  }
}

function setLocationBusy(busy) {
  const button = document.getElementById("use-location");
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
}

function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus("This browser can't share a location. Search for the course instead.", "error");
    return;
  }

  // The request id is claimed on the tap rather than when the fix lands,
  // so a search started while GPS is still thinking wins — the same
  // staleness guard the search path uses.
  const requestId = ++latestRequestId;
  setStatus("Finding you on the course\u2026", "loading");
  setLocationBusy(true);

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setLocationBusy(false);
      if (requestId !== latestRequestId) return; // superseded while waiting

      const { latitude, longitude } = position.coords;
      loadPlace(
        {
          name: "My location",
          region: formatCoordinates(latitude, longitude),
          latitude,
          longitude,
        },
        requestId
      );
    },
    (err) => {
      setLocationBusy(false);
      if (requestId !== latestRequestId) return; // superseded while waiting
      console.error(err);
      setStatus(describeGeolocationError(err), "error");
    },
    GEOLOCATION_OPTIONS
  );
}

function initGeolocation() {
  document.getElementById("use-location").addEventListener("click", useMyLocation);
}

function initSearchForm() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("city-input");
  const button = document.getElementById("search-button");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (button.disabled) return; // belt-and-braces against double submission
    loadCity(input.value);
  });
}

initTheme();
initSearchForm();
initSavedPlaces();
initGeolocation();

// Open on the first saved course when there is one, otherwise the default.
const savedOnLoad = readSavedPlaces();
if (savedOnLoad.length > 0) {
  loadPlace(savedOnLoad[0]);
} else {
  loadCity(DEFAULT_CITY_QUERY);
}
