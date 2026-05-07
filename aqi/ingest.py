# aqi/ingest.py
import os
import time
import re
import requests
from django.db import transaction
from django.utils import timezone
from .models import Station, Reading, TemperatureReading


WAQI_TOKEN = os.getenv("WAQI_TOKEN", "")
WAQI_BBOX = os.getenv("WAQI_BBOX", "51.0,-0.6,51.8,0.5")

BOUNDS_URL = f"https://api.waqi.info/map/bounds/?token={WAQI_TOKEN}&latlng={WAQI_BBOX}"
FEED_URL = "https://api.waqi.info/feed/@{uid}/?token={token}"
METEO_URL = "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m&timezone=auto"

import os
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from django.db import transaction
from .models import Station, Reading, TemperatureReading

# ---- resilient HTTP client (shared) ----
SESSION = requests.Session()
RETRY = Retry(
    total=3, connect=3, read=3,
    backoff_factor=0.6,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"],
    raise_on_status=False,
)
ADAPTER = HTTPAdapter(max_retries=RETRY, pool_connections=20, pool_maxsize=50)
SESSION.mount("https://", ADAPTER)
SESSION.mount("http://", ADAPTER)
DEFAULT_TIMEOUT = (5, 30)

HOURLY_VARS = ",".join([
    "temperature_2m",
    "pressure_msl",
    "surface_pressure",
    "cloudcover",
    "visibility",
    "weather_code",
    "precipitation",
    "windspeed_10m",
    "soil_temperature_6cm",
])
METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    f"&hourly={HOURLY_VARS}"
    "&forecast_days=1"
    "&timezone=auto"
)

def _extract_latest_vars(j):
    h = j.get("hourly") or {}
    times = h.get("time") or []
    if not times:
        return None, {}
    i = len(times) - 1
    def pick(k):
        arr = h.get(k)
        return arr[i] if isinstance(arr, list) and len(arr) > i else None
    return times[i], {
        "temp_c":                 pick("temperature_2m"),
        "pressure_msl_hpa":       pick("pressure_msl"),
        "surface_pressure_hpa":   pick("surface_pressure"),
        "cloudcover_pct":         pick("cloudcover"),
        "visibility_m":           pick("visibility"),
        "weather_code":           pick("weather_code"),
        "precipitation_mm":       pick("precipitation"),
        "windspeed_10m_ms":       pick("windspeed_10m"),
        "soil_temperature_6cm_c": pick("soil_temperature_6cm"),
    }

def ingest_temperature_once():
    from .ingest import _ensure_station, WAQI_TOKEN, WAQI_BBOX  # if defined elsewhere
    BOUNDS_URL = f"https://api.waqi.info/map/bounds/?token={WAQI_TOKEN}&latlng={WAQI_BBOX}"

    if not WAQI_TOKEN:
        print("[ingest][TEMP] WAQI_TOKEN missing; skipping")
        return

    try:
        bounds = _fetch_json(BOUNDS_URL)
    except Exception as e:
        print("[ingest][TEMP] bounds failed:", e)
        return

    if bounds.get("status") != "ok":
        print("[ingest][TEMP] WAQI bounds returned non-ok:", bounds)
        return

    inserted = updated = skipped = failed = 0

    for rec in bounds["data"]:
        try:
            st = _ensure_station(rec)
            lat = float(rec["lat"]); lon = float(rec["lon"])

            meteo = _fetch_json(METEO_URL.format(lat=lat, lon=lon))
            iso, vals = _extract_latest_vars(meteo)
            if not iso:
                skipped += 1
                continue

            # IMPORTANT: update_or_create so existing rows get filled in
            obj, is_created = TemperatureReading.objects.update_or_create(
                station=st,
                observed_iso=str(iso),
                defaults={**vals, "raw": meteo}
            )
            if is_created: inserted += 1
            else:          updated += 1

            time.sleep(0.05)  # be polite to API
        except (requests.Timeout, requests.ConnectionError) as e:
            failed += 1
            print(f"[ingest][TEMP] station {rec.get('uid')} network error: {e}")
        except Exception as e:
            failed += 1
            print(f"[ingest][TEMP] station {rec.get('uid')} failed: {e}")

    print(f"[ingest][TEMP] inserted={inserted}, updated={updated}, skipped={skipped}, failed={failed}")


def _fetch_json(url, timeout=DEFAULT_TIMEOUT, session=SESSION):
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()

def _ensure_station(rec) -> Station:
    """
    Ensure a Station row exists/updated for a WAQI map/bounds record.
    """
    uid = int(rec["uid"])
    lat = float(rec["lat"])
    lon = float(rec["lon"])
    # Some bounds payloads have station info, some do not.
    name = (rec.get("station") or {}).get("name") if isinstance(rec.get("station"), dict) else None

    obj, created = Station.objects.update_or_create(
        uid=uid,
        defaults={"name": name, "lat": lat, "lon": lon},
    )
    return obj

# ----------------------------
# AQI ingest (unchanged idea)
# ----------------------------
def ingest_aqi_once():
    if not WAQI_TOKEN:
        print("[ingest][AQI] WAQI_TOKEN missing; skipping AQI ingest")
        return

    data = _fetch_json(BOUNDS_URL)
    if data.get("status") != "ok":
        print("[ingest][AQI] WAQI bounds returned non-ok:", data)
        return


    for rec in data["data"]:
        try:
            st = _ensure_station(rec)

            feed = _fetch_json(FEED_URL.format(uid=rec["uid"], token=WAQI_TOKEN))
            if feed.get("status") != "ok":
                continue

            d = feed["data"]
            aqi_val = parse_aqi(d.get("aqi"), default=-1)
            iaqi = d.get("iaqi") or None
            waqi_time = (d.get("time") or {}).get("s")

            Reading.objects.create(
                station=st,
                aqi=aqi_val if aqi_val >= 0 else 0,  # store 0 if missing/bad
                iaqi=iaqi,
                raw=feed,
                waqi_time=waqi_time,
            )
        except Exception as e:
            # this will be much rarer now
            print(f"[ingest][AQI] station {rec.get('uid')} failed: {e}")

    print("[ingest][AQI] done")

# ----------------------------------------
# Temperature ingest (new) — every minute
# ----------------------------------------
def _extract_latest_temp(j):
    h = j.get("hourly") or {}
    times = h.get("time") or []
    temps = h.get("temperature_2m") or []
    if not times or not temps:
        return None
    return {"iso": times[-1], "temp": temps[-1]}

def ingest_temperature_once():
    if not WAQI_TOKEN:
        print("[ingest][TEMP] WAQI_TOKEN missing; skipping temp ingest")
        return

    data = _fetch_json(BOUNDS_URL)
    if data.get("status") != "ok":
        print("[ingest][TEMP] WAQI bounds returned non-ok:", data)
        return

    created = 0
    skipped = 0
    DEBUG_FIRST = {"done": False}  # module-level or just before the loop

    for rec in data["data"]:
        try:
            st = _ensure_station(rec)
            lat = float(rec["lat"])
            lon = float(rec["lon"])

            meteo = _fetch_json(METEO_URL.format(lat=lat, lon=lon))
            latest = _extract_latest_temp(meteo)
            if not latest or latest["temp"] is None:
                skipped += 1
                continue

            # Avoid duplicates per station/time (unique_together)
            obj, was_created = TemperatureReading.objects.get_or_create(
                station=st,
                observed_iso=str(latest["iso"]),
                defaults={
                    "temp_c": float(latest["temp"]),
                    "raw": meteo
                }
            )
            if was_created:
                created += 1
            else:
                # Optionally update temp if it changed
                # obj.temp_c = float(latest["temp"])
                # obj.raw = meteo
                # obj.save(update_fields=["temp_c", "raw"])
                pass

        except Exception as e:
            print(f"[ingest][TEMP] station {rec.get('uid')} failed: {e}")

    print(f"[ingest][TEMP] inserted={created}, skipped/dupe={skipped}")

# ------------------------------------------------
# Entry point called by manage.py + the scheduler
# ------------------------------------------------
def run_ingest_once():
    with transaction.atomic():
        ingest_aqi_once()
    ingest_temperature_once()


def parse_aqi(value, default=-1):
    """
    WAQI sometimes returns '-', 'N/A', '', or strings with text.
    Return an int or `default` if it can't be parsed.
    """
    if value is None:
        return default
    if isinstance(value, (int, float)):
        try:
            return int(value)
        except Exception:
            return default

    s = str(value).strip()
    if s in {"", "-", "—", "NA", "N/A", "null", "None"}:
        return default

    m = re.search(r"-?\d+", s)
    if not m:
        return default
    try:
        return int(m.group(0))
    except Exception:
        return default
