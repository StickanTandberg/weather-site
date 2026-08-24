// ---------------------------------------------------------------------
// Default city shown when the page first loads. Search replaces this.
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
  button.textContent = current === "dark" ? "Light mode" : "Dark mode";
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
    `&current=temperature_2m,apparent_temperature,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=5`;

  const data = await fetchJson(url);
  console.log("Open-Meteo forecast response:", data);
  return data;
}

// Reshape the raw Open-Meteo response + matched place into the flat
// shape render() expects.
function toRenderData(apiResponse, place) {
  const { current, current_units, daily } = apiResponse;

  return {
    city: place.name,
    region: [place.admin1, place.country].filter(Boolean).join(", "),
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

  card.innerHTML = `
    <section class="current">
      <h1 class="city">${data.city}</h1>
      <p class="region">${data.region}</p>
      <p class="temp-now">${data.currentTemp}${data.tempUnit}</p>
      <p class="conditions">${data.conditions}</p>
      <p class="feels-like">Feels like ${data.feelsLike}${data.tempUnit}</p>
      <p class="last-updated">Last updated ${data.lastUpdated}</p>
    </section>
    <section class="forecast">
      <h2 class="forecast-heading">5-Day Forecast</h2>
      <div class="forecast-row">
        ${forecastHtml}
      </div>
    </section>
  `;
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
      return;
    }

    const apiResponse = await fetchForecast(place.latitude, place.longitude);
    if (requestId !== latestRequestId) return; // a newer search superseded this one

    render(toRenderData(apiResponse, place));
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
loadCity(DEFAULT_CITY_QUERY);
