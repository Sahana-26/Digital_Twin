# aqi/admin.py
from django.contrib import admin
from .models import Station, Reading, TemperatureReading

@admin.register(Station)
class StationAdmin(admin.ModelAdmin):
    list_display = ("uid", "name", "lat", "lon", "created_at")

@admin.register(Reading)
class ReadingAdmin(admin.ModelAdmin):
    list_display = ("station", "aqi", "waqi_time", "created_at")
    list_filter = ("station",)

@admin.register(TemperatureReading)
class TemperatureReadingAdmin(admin.ModelAdmin):
    list_display = (
        "station", "observed_iso", "temp_c",
        "pressure_msl_hpa", "surface_pressure_hpa",
        "cloudcover_pct", "visibility_m",
        "precipitation_mm", "windspeed_10m_ms",
        "soil_temperature_6cm_c", "created_at"
    )
    list_filter = ("station",)
