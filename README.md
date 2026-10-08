# World Clock

Type a city name and see its current time, date and day of the week, each as an analog display and as digital text, updating every second.

Plain HTML, CSS and JavaScript. No installs, no API keys. Open `index.html` in a browser, or deploy the folder as-is to Vercel.

- City lookup: [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api) (free, no key). Places it doesn't know (such as Kiritimati) are added in `EXTRA_PLACES` in `app.js`.
- Local time: the browser's built-in time-zone database (`Intl.DateTimeFormat`), so daylight saving, half and quarter-hour zones and the date line are handled automatically.

## Testing with a simulated clock

Add `?now=<UTC time>` to the address to start the clock at that moment. It then runs forward in real time, and a yellow banner shows that the clock is simulated.

| Test | Address | Then search |
|---|---|---|
| Midnight rollover | `index.html?now=2026-10-07T18:14:50Z` | Kathmandu (reaches 00:00:00 after 10 s) |
| DST ends, New York | `index.html?now=2026-11-01T05:59:50Z` | New York (01:59:59 → 01:00:00, UTC−4 → UTC−5) |
| DST starts, New York | `index.html?now=2026-03-08T06:59:50Z` | New York (01:59:59 → 03:00:00, UTC−5 → UTC−4) |
