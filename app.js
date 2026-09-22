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

// How many loads are waiting on the network. The background refresh
// stands down while one is in flight, so it can never claim a request id
// and cancel a search the player is waiting on.
let inFlightLoads = 0;

// When the forecast on screen was last fetched, so a page coming back
// from the background can tell whether it has gone stale.
let lastLoadedAt = 0;

// Loads a place that's already been resolved to coordinates — a saved
// place, a fresh geocoding hit, or the ten-minute refresh.
//
// A quiet load is that refresh: it repaints the card and the compass but
// leaves the status line and the search box alone, so the page doesn't
// flash "Loading…" and grey out the search every ten minutes while
// you're standing over a shot.
async function loadPlace(place, requestId = ++latestRequestId, { quiet = false } = {}) {
  if (!quiet) {
    setStatus(`Loading conditions for ${place.name}…`, "loading");
    setSearchDisabled(true);
  }
  inFlightLoads += 1;

  try {
    const apiResponse = await fetchForecast(place.latitude, place.longitude);
    if (requestId !== latestRequestId) return; // a newer search superseded this one

    currentPlace = place;
    const data = toRenderData(apiResponse, place);
    render(data);
    currentWind = data.wind;
    lastLoadedAt = Date.now();
    paintCompass(); // no-op while the compass is closed
    renderSavedPlaces(); // refresh which saved chip is highlighted

    if (!quiet) setStatus("", null);
  } catch (err) {
    if (requestId !== latestRequestId) return; // a newer search superseded this one
    console.error(err);
    // A failed background refresh keeps quiet: what's on screen is still
    // the best we have, and its "Last updated" time stops advancing,
    // which is the honest signal that it's going stale.
    if (!quiet) setStatus(describeError(err), "error");
  } finally {
    inFlightLoads -= 1;
    if (!quiet && requestId === latestRequestId) {
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
  inFlightLoads += 1;

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
  } finally {
    inFlightLoads -= 1;
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

// ---------------------------------------------------------------------
// Wind compass. The dial deliberately lives outside #weather-card:
// render() replaces that element's contents wholesale on every load, so
// a dial in there would be torn out from under its own animation.
//
// Every angle below is degrees clockwise from north:
//   heading   the way the phone — and so the player — is pointing
//   direction the way the wind blows FROM, as Open-Meteo reports it
//   relative  (direction - heading): where the wind comes from relative
//             to the way you're facing, so 0 is straight in your face
//
// The heading is pinned to 0 until the sensor arrives, which is simply a
// north-up chart: correct, just not live.
// ---------------------------------------------------------------------
const compassState = {
  open: false,
  heading: 0,          // what's on screen now, eased toward targetHeading
  targetHeading: null, // the newest sensor reading, null until one lands
  hasSensor: false,
  status: "idle",      // idle | starting | live | denied | unavailable
  sourceRank: 0,       // which kind of reading we've locked onto
  rafId: null,
  sensorTimeoutId: null,
  refreshId: null,
  suspended: false,    // hidden tab: listeners dropped, permission kept
};

// How much of the gap to the newest reading to close each frame. Lower is
// smoother but laggier; 0.15 settles in about a fifth of a second and
// still swallows the jitter a phone magnetometer produces.
const HEADING_SMOOTHING = 0.15;

// A reading has to arrive within this long, or we decide there's no
// usable compass and fall back to the north-up dial.
const SENSOR_TIMEOUT_MS = 2500;

// How often the forecast is refetched while the compass is on screen.
// Open-Meteo updates hourly, so this is about keeping a long round
// honest rather than chasing new data.
const COMPASS_REFRESH_MS = 10 * 60 * 1000;

// Wind from the most recent forecast, so the compass can repaint without
// refetching. Kept in step with the card by loadPlace().
let currentWind = null;

function relativeWindAngle(windDirection, heading) {
  return (((windDirection - heading) % 360) + 360) % 360;
}

// Sectors measured from straight ahead: within 30 degrees is a head or
// tail wind, 60-120 is across, and the 30-degree wedges between them are
// quartering. "Off the right" means the wind arrives over your right
// shoulder, so the ball drifts left.
function describeRelativeWind(relative) {
  const angle = ((relative % 360) + 360) % 360;

  if (angle <= 30 || angle >= 330) {
    return { label: "Headwind", hint: "Club up and swing easy." };
  }
  if (angle < 60) {
    return { label: "Quartering headwind, off the right", hint: "Club up; the ball drifts left." };
  }
  if (angle <= 120) {
    return { label: "Crosswind, off the right", hint: "Aim right — the ball drifts left." };
  }
  if (angle < 150) {
    return { label: "Quartering tailwind, off the right", hint: "Club down; the ball drifts left." };
  }
  if (angle <= 210) {
    return { label: "Tailwind", hint: "Club down — it will run out." };
  }
  if (angle < 240) {
    return { label: "Quartering tailwind, off the left", hint: "Club down; the ball drifts right." };
  }
  if (angle <= 300) {
    return { label: "Crosswind, off the left", hint: "Aim left — the ball drifts right." };
  }
  return { label: "Quartering headwind, off the left", hint: "Club up; the ball drifts right." };
}

// Shortest signed way from one bearing to another, always in -180..180.
// This is what stops the dial taking the long way round when the heading
// crosses north: 359 -> 5 is +6 degrees, not -354.
function angleDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

// One step of a low-pass filter, run per animation frame.
function smoothHeading(current, target, factor) {
  const stepped = current + angleDelta(current, target) * factor;
  return ((stepped % 360) + 360) % 360;
}

// How far the page itself is rotated from the device's natural
// orientation. The sensor reports where the device's top edge points, so
// this is added to get where the top of the *screen* points.
function screenAngle() {
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  return Number(angle) || 0;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Sources ranked by how much they can be trusted. A better source may
// take over later, a worse one is ignored once a better one is running.
//   3  iOS webkitCompassHeading — already true north, clockwise
//   2  an absolute event — north-referenced via the magnetometer
//   1  plain alpha — relative to wherever the device booted, and it
//      drifts, but it's what desktop orientation emulation provides
function orientationSourceRank(event) {
  if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
    return 3;
  }
  if (event.type === "deviceorientationabsolute" || event.absolute === true) {
    return 2;
  }
  return 1;
}

function headingFromEvent(event) {
  // iOS hands us a compass bearing directly.
  if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
    return event.webkitCompassHeading;
  }
  // Everywhere else alpha counts anticlockwise from north, so it has to
  // be flipped to read as a clockwise bearing.
  if (typeof event.alpha === "number" && !Number.isNaN(event.alpha)) {
    return (360 - event.alpha) % 360;
  }
  return null; // an event with nothing usable in it
}

// Stores the newest reading and nothing else — the DOM is only touched
// from the animation frame, so a sensor firing 60 times a second can't
// turn into 60 layouts.
function handleOrientationEvent(event) {
  const rank = orientationSourceRank(event);
  if (rank < compassState.sourceRank) return; // a worse source; ignore it

  const heading = headingFromEvent(event);
  if (heading === null) return;

  compassState.sourceRank = rank;
  compassState.targetHeading = (((heading + screenAngle()) % 360) + 360) % 360;

  if (!compassState.hasSensor) {
    // First usable reading: adopt it outright rather than easing to it
    // from an arbitrary north, which would spin the dial on startup.
    compassState.heading = compassState.targetHeading;
    compassState.hasSensor = true;
    setCompassStatus("live");
    window.clearTimeout(compassState.sensorTimeoutId);
    compassState.sensorTimeoutId = null;
  }
}

// Both names are attached: Chrome fires deviceorientationabsolute, iOS
// only ever fires deviceorientation, and Firefox marks its plain event
// absolute. The ranking above sorts out which one to believe.
const ORIENTATION_EVENTS = ["deviceorientationabsolute", "deviceorientation"];

function attachOrientationListeners() {
  detachOrientationListeners(); // idempotent, so a retry can't stack timeouts

  for (const name of ORIENTATION_EVENTS) {
    window.addEventListener(name, handleOrientationEvent);
  }

  // Desktop browsers happily add the listener and then never fire it.
  compassState.sensorTimeoutId = window.setTimeout(() => {
    if (!compassState.hasSensor) setCompassStatus("unavailable");
  }, SENSOR_TIMEOUT_MS);

  startCompassLoop();
}

function detachOrientationListeners() {
  for (const name of ORIENTATION_EVENTS) {
    window.removeEventListener(name, handleOrientationEvent);
  }
  window.clearTimeout(compassState.sensorTimeoutId);
  compassState.sensorTimeoutId = null;
}

// iOS 13+ gates the sensor behind a permission call that only works
// inside a user gesture — hence the Start compass button.
function orientationNeedsPermission() {
  return (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  );
}

async function startCompassSensor() {
  if (compassState.status === "live" || compassState.status === "starting") return;
  setCompassStatus("starting");

  if (orientationNeedsPermission()) {
    try {
      const response = await DeviceOrientationEvent.requestPermission();
      if (response !== "granted") {
        setCompassStatus("denied");
        return;
      }
    } catch (err) {
      // Thrown when the call didn't come from a tap, or the page isn't
      // on HTTPS. Either way there's no sensor to be had.
      console.error(err);
      setCompassStatus("denied");
      return;
    }
  }

  attachOrientationListeners();
}

function stopCompassSensor() {
  detachOrientationListeners();
  stopCompassLoop();
  compassState.suspended = false;
  compassState.hasSensor = false;
  compassState.sourceRank = 0;
  compassState.targetHeading = null;
  compassState.heading = 0; // back to the north-up chart
  setCompassStatus("idle");
}

// The single place the dial is repainted from. Everything else just
// updates state and lets this pick it up on the next frame.
function compassFrame() {
  const target = compassState.targetHeading;

  if (target !== null) {
    const next = prefersReducedMotion()
      ? target // no easing: step straight to the reading
      : smoothHeading(compassState.heading, target, HEADING_SMOOTHING);

    // Below about a twentieth of a degree there's nothing to see, so
    // skip the repaint and let the browser idle.
    if (Math.abs(angleDelta(compassState.heading, next)) > 0.05) {
      compassState.heading = next;
      paintCompass();
    }
  }

  compassState.rafId = window.requestAnimationFrame(compassFrame);
}

function startCompassLoop() {
  if (compassState.rafId === null) {
    compassState.rafId = window.requestAnimationFrame(compassFrame);
  }
}

function stopCompassLoop() {
  if (compassState.rafId !== null) {
    window.cancelAnimationFrame(compassState.rafId);
    compassState.rafId = null;
  }
}

// ---------------------------------------------------------------------
// Keeping the wind current, and staying out of the way when the page
// isn't being looked at. A phone in a back pocket between holes should
// not be running a magnetometer, an animation frame and a timer.
// ---------------------------------------------------------------------
function refreshWindQuietly() {
  // Nothing to refetch, or a user-initiated load is already running and
  // would be cancelled if this claimed a newer request id.
  if (!currentPlace || inFlightLoads > 0 || document.hidden) return;
  loadPlace(currentPlace, ++latestRequestId, { quiet: true });
}

function startCompassRefresh() {
  stopCompassRefresh(); // never stack two timers
  compassState.refreshId = window.setInterval(refreshWindQuietly, COMPASS_REFRESH_MS);
}

function stopCompassRefresh() {
  if (compassState.refreshId !== null) {
    window.clearInterval(compassState.refreshId);
    compassState.refreshId = null;
  }
}

// Hidden tab: drop the listeners, the frame loop and the timer, but hold
// on to the heading and the granted permission so coming back doesn't
// cost another tap.
function suspendCompass() {
  stopCompassRefresh();
  stopCompassLoop();

  if (compassState.status === "live") {
    detachOrientationListeners();
    compassState.suspended = true;
  }
}

function resumeCompass() {
  if (!compassState.open) return;

  if (compassState.suspended) {
    compassState.suspended = false;
    attachOrientationListeners(); // restarts the frame loop too
  }

  startCompassRefresh();

  // Back from a spell in a pocket: if the forecast has aged past a
  // refresh interval, don't wait another ten minutes for fresh wind.
  if (Date.now() - lastLoadedAt > COMPASS_REFRESH_MS) {
    refreshWindQuietly();
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    suspendCompass();
  } else {
    resumeCompass();
  }
}

function setCompassStatus(status) {
  compassState.status = status;
  // The button is only worth offering when a tap could still achieve
  // something: not while it's running, and not after a refusal that iOS
  // won't ask about again.
  const startButton = document.getElementById("compass-start");
  startButton.hidden = !(compassState.open && (status === "idle" || status === "unavailable"));
  startButton.disabled = status === "starting";
  paintCompass();
}

function compassFacingText() {
  switch (compassState.status) {
    case "live": {
      const heading = Math.round(compassState.heading) % 360;
      return `Facing ${heading}\u00b0 (${compassFromDegrees(heading)})`;
    }
    case "starting":
      return "Waking the compass\u2026";
    case "denied":
      return "Compass permission denied — the dial is locked north up.";
    case "unavailable":
      return "No compass sensor — the dial is locked north up.";
    default:
      return "Start the compass to have the dial follow the way you're facing.";
  }
}

// Writes the whole compass from compassState + currentWind. Cheap enough
// to call on every animation frame once the sensor is driving it.
function paintCompass() {
  if (!compassState.open) return; // nothing to paint while it's closed

  const panel = document.getElementById("wind-compass");
  const direction = currentWind?.direction;
  const hasDirection = direction !== null && direction !== undefined && !Number.isNaN(Number(direction));

  panel.classList.toggle("has-wind", hasDirection);

  // The rose turns against the phone, so north keeps pointing north.
  document.getElementById("compass-rose").style.transform =
    `rotate(${-compassState.heading}deg)`;

  const speedUnit = currentWind?.speedUnit ? ` ${currentWind.speedUnit}` : "";
  document.getElementById("compass-speed").textContent = formatValue(
    currentWind?.speed ?? null,
    speedUnit
  );

  const gusts = currentWind?.gusts ?? null;
  document.getElementById("compass-gusts").textContent =
    gusts === null ? "" : `gusting ${formatValue(gusts, speedUnit)}`;

  document.getElementById("compass-from").textContent = hasDirection
    ? `from ${compassFromDegrees(direction)}`
    : "wind direction unavailable";

  const readout = document.getElementById("compass-readout");
  const hint = document.getElementById("compass-hint");

  if (hasDirection) {
    const relative = relativeWindAngle(Number(direction), compassState.heading);
    // Same convention as the daily strip: the arrow points where the
    // wind blows TO, which is half a turn from where it comes FROM.
    document.getElementById("compass-wind").style.transform =
      `rotate(${relative + 180}deg)`;

    const read = describeRelativeWind(relative);
    readout.textContent = read.label;
    hint.textContent = read.hint;
  } else {
    readout.textContent = currentWind ? "No wind direction for this spot" : "Waiting for wind data…";
    hint.textContent = "";
  }

  document.getElementById("compass-facing").textContent = compassFacingText();
}

function openCompass() {
  compassState.open = true;
  document.getElementById("wind-compass").hidden = false;
  const toggle = document.getElementById("compass-toggle");
  toggle.setAttribute("aria-expanded", "true");
  toggle.classList.add("is-active");
  paintCompass();

  if (orientationNeedsPermission()) {
    // iOS: the sensor can only be asked for from inside a tap, so wait
    // for one rather than firing a request that's guaranteed to throw.
    setCompassStatus("idle");
  } else {
    // Everywhere else there's nothing to ask for, so save the tap.
    startCompassSensor();
  }

  startCompassRefresh();
}

function closeCompass() {
  compassState.open = false;
  document.getElementById("wind-compass").hidden = true;
  const toggle = document.getElementById("compass-toggle");
  toggle.setAttribute("aria-expanded", "false");
  toggle.classList.remove("is-active");
  stopCompassRefresh();
  stopCompassSensor(); // no listeners or animation frames while it's shut
}

function initCompass() {
  document.getElementById("compass-toggle").addEventListener("click", () => {
    if (compassState.open) {
      closeCompass();
    } else {
      openCompass();
    }
  });

  document.getElementById("compass-start").addEventListener("click", startCompassSensor);

  document.addEventListener("visibilitychange", handleVisibilityChange);
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
initCompass();

// Open on the first saved course when there is one, otherwise the default.
const savedOnLoad = readSavedPlaces();
if (savedOnLoad.length > 0) {
  loadPlace(savedOnLoad[0]);
} else {
  loadCity(DEFAULT_CITY_QUERY);
}
