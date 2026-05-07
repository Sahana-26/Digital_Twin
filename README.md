
# Cesium AQI Heatmap (Django + Postgres)
This project serves a Cesium heatmap page and **ingests WAQI data once** automatically
every time you run any `manage.py` command (e.g. `runserver`, `migrate`, etc.).

## Quick start
```bash
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.sample .env
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```
> On every `manage.py` invocation, the script fetches bounds + details, and inserts a Reading per station.

## Notes
- Replace `aqi/static/CesiumHeatmap.js` with your real plugin if you have one.
- Configure `.env` with your Postgres & WAQI token.
