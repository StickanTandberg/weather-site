// ---------------------------------------------------------------------
// City coordinates — hardcoded for now, search comes later.
// ---------------------------------------------------------------------
const LATITUDE = 59.3293;
const LONGITUDE = 18.0686;
const CITY_NAME = "Stockholm";

const FORECAST_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${LATITUDE}&longitude=${LONGITUDE}` +
  `&current=temperature_2m,apparent_temperature,weather_code` +
  `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
  `&timezone=auto&forecast_days=5`;

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

// Reshape the raw Open-Meteo response into the flat shape render() expects.
function toRenderData(apiResponse) {
  const { current, current_units, daily } = apiResponse;

  return {
    city: CITY_NAME,
    currentTemp: current.temperature_2m,
    feelsLike: current.apparent_temperature,
    conditions: describeWeatherCode(current.weather_code),
    tempUnit: current_units.temperature_2m,
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
      <p class="temp-now">${data.currentTemp}${data.tempUnit}</p>
      <p class="conditions">${data.conditions}</p>
      <p class="feels-like">Feels like ${data.feelsLike}${data.tempUnit}</p>
    </section>
    <section class="forecast">
      <h2 class="forecast-heading">5-Day Forecast</h2>
      <div class="forecast-row">
        ${forecastHtml}
      </div>
    </section>
  `;
}

async function init() {
  const response = await fetch(FORECAST_URL);
  const apiResponse = await response.json();

  console.log("Open-Meteo raw response:", apiResponse);

  render(toRenderData(apiResponse));
}

init();
