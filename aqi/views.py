
from django.shortcuts import render
from django.conf import settings

def index(request):
    ctx = {
        'CESIUM_ION_TOKEN': settings.CESIUM_ION_TOKEN,
        'WAQI_TOKEN': settings.WAQI_TOKEN,
        'WAQI_BBOX': settings.WAQI_BBOX,
    }
    return render(request, 'aqi/index.html', ctx)



# aqi/views.py
import os
from datetime import timedelta
from django.http import JsonResponse
from django.utils import timezone
from django.db.models import Avg, Min, Max, FloatField, F
from django.db.models.functions import TruncHour, Cast

from .models import Reading

def _bbox_filter(qs):
    """Limit to env WAQI_BBOX if present: 'lat1,lon1,lat2,lon2'."""
    bbox = os.getenv("WAQI_BBOX", "")
    try:
        lat1, lon1, lat2, lon2 = [float(x) for x in bbox.split(",")]
        lo_lat, hi_lat = sorted([lat1, lat2])
        lo_lon, hi_lon = sorted([lon1, lon2])
        qs = qs.filter(station__lat__gte=lo_lat, station__lat__lte=hi_lat,
                       station__lon__gte=lo_lon, station__lon__lte=hi_lon)
    except Exception:
        pass
    return qs

def aqi_hourly_metrics(request):
    """
    Returns hourly aggregates for the last N hours (default 24).
    {
      labels: [ISO hour ...],
      aqi: {avg:[], min:[], max:[]},
      iaqi: {pm25:[], pm10:[], o3:[], no2:[], so2:[], co:[], t:[], h:[], p:[], w:[], wg:[]}
    }
    """
    hours = int(request.GET.get("hours", "24"))
    now = timezone.now()
    since = now - timedelta(hours=hours)

    qs = Reading.objects.filter(created_at__gte=since)
    qs = _bbox_filter(qs)

    # Helper to cast JSON iaqi->key->v to float for aggregation
    def J(key):
        return Cast(F(f"iaqi__{key}__v"), FloatField())

    rows = (
        qs.annotate(hour=TruncHour("created_at"))
          .values("hour")
          .annotate(
              aqi_avg=Avg("aqi"),
              aqi_min=Min("aqi"),
              aqi_max=Max("aqi"),

              pm25=Avg(J("pm25")), pm10=Avg(J("pm10")),
              o3=Avg(J("o3")), no2=Avg(J("no2")), so2=Avg(J("so2")), co=Avg(J("co")),
              t=Avg(J("t")), h=Avg(J("h")), p=Avg(J("p")), w=Avg(J("w")), wg=Avg(J("wg")),
          )
          .order_by("hour")
    )

    labels = [r["hour"].isoformat() for r in rows]
    data = {
        "labels": labels,
        "aqi": {
            "avg": [r["aqi_avg"] for r in rows],
            "min": [r["aqi_min"] for r in rows],
            "max": [r["aqi_max"] for r in rows],
        },
        "iaqi": {
            "pm25": [r["pm25"] for r in rows],
            "pm10": [r["pm10"] for r in rows],
            "o3":   [r["o3"]   for r in rows],
            "no2":  [r["no2"]  for r in rows],
            "so2":  [r["so2"]  for r in rows],
            "co":   [r["co"]   for r in rows],
            "t":    [r["t"]    for r in rows],
            "h":    [r["h"]    for r in rows],
            "p":    [r["p"]    for r in rows],
            "w":    [r["w"]    for r in rows],
            "wg":   [r["wg"]   for r in rows],
        }
    }
    return JsonResponse(data)


# aqi/views.py
import datetime

from django.db.models import Avg, FloatField, F
from django.db.models.functions import TruncHour, Cast
from django.http import JsonResponse
from django.utils import timezone

from .models import Reading, Station

def aqi_station_hourly_timeseries(request):
    """
    For each station, return its hourly AQI + temperature series
    over the last N hours (default 24), taken from the DB.
    """
    try:
        hours = int(request.GET.get("hours", 24))
    except (TypeError, ValueError):
        hours = 24

    now = timezone.now()
    since = now - datetime.timedelta(hours=hours)

    qs = (
        Reading.objects
        .filter(created_at__gte=since)
        .select_related("station")
    )

    # If you have _bbox_filter, you can apply it here:
    # qs = _bbox_filter(qs, request)

    qs = (
        qs.annotate(hour=TruncHour("created_at"))
          .values(
              "station_id",
              "station__name",
              "station__lat",
              "station__lon",
              "hour",
          )
          .annotate(
              aqi=Avg("aqi"),
              temp=Avg(Cast(F("iaqi__t__v"), FloatField())),
          )
          .order_by("station_id", "hour")
    )

    stations = {}
    for row in qs:
        sid = row["station_id"]
        local_hour = timezone.localtime(row["hour"])
        iso_time = local_hour.isoformat()

        s = stations.setdefault(
            sid,
            {
                "uid": sid,
                "name": row["station__name"],
                "lat": row["station__lat"],
                "lon": row["station__lon"],
                "times": [],
                "aqi": [],
                "temp": [],
            },
        )

        s["times"].append(iso_time)
        s["aqi"].append(float(row["aqi"]) if row["aqi"] is not None else None)
        s["temp"].append(float(row["temp"]) if row["temp"] is not None else None)

    return JsonResponse({"stations": list(stations.values())})
