// ---------------------------------------------------------------------
// WEATHER_DATA — replace this object with real API data when ready.
// Shape must stay the same for render() below to keep working.
// ---------------------------------------------------------------------
const WEATHER_DATA = {
  city: "Stockholm",
  currentTemp: 19,
  feelsLike: 17,
  conditions: "Partly cloudy",
  forecast: [
    { day: "Mon", high: 21, low: 13 },
    { day: "Tue", high: 22, low: 14 },
    { day: "Wed", high: 18, low: 12 },
    { day: "Thu", high: 17, low: 11 },
    { day: "Fri", high: 20, low: 13 },
  ],
};
// ---------------------------------------------------------------------

function render(data) {
  const card = document.getElementById("weather-card");

  const forecastHtml = data.forecast
    .map(
      (d) => `
      <div class="forecast-day">
        <span class="forecast-day-name">${d.day}</span>
        <span class="forecast-high">${d.high}°</span>
        <span class="forecast-low">${d.low}°</span>
      </div>
    `
    )
    .join("");

  card.innerHTML = `
    <section class="current">
      <h1 class="city">${data.city}</h1>
      <p class="temp-now">${data.currentTemp}°</p>
      <p class="conditions">${data.conditions}</p>
      <p class="feels-like">Feels like ${data.feelsLike}°</p>
    </section>
    <section class="forecast">
      <h2 class="forecast-heading">5-Day Forecast</h2>
      <div class="forecast-row">
        ${forecastHtml}
      </div>
    </section>
  `;
}

render(WEATHER_DATA);
