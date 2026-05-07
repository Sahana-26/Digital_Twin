# aqi/models.py
from django.db import models

class Station(models.Model):
    uid = models.IntegerField(primary_key=True)
    name = models.CharField(max_length=255, blank=True, null=True)
    lat = models.FloatField()
    lon = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'waqi_stations'

    def __str__(self):
        return f"{self.uid} - {self.name or 'Station'}"


class Reading(models.Model):
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name='readings')
    aqi = models.IntegerField()
    iaqi = models.JSONField(blank=True, null=True)
    raw = models.JSONField(blank=True, null=True)
    waqi_time = models.CharField(max_length=64, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'waqi_readings'
        indexes = [
            models.Index(fields=['created_at']),
            models.Index(fields=['station', 'created_at']),
        ]

    def __str__(self):
        return f"Reading({self.station_id}, AQI={self.aqi}, at {self.created_at})"


class TemperatureReading(models.Model):
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name='temp_readings')
    observed_iso = models.CharField(max_length=64, blank=True, null=True)  # timestamp from Open-Meteo

    # main temperature
    temp_c = models.FloatField(null=True)

    # NEW hourly variables (units match Open-Meteo defaults)
    pressure_msl_hpa = models.FloatField(null=True)        # hPa
    surface_pressure_hpa = models.FloatField(null=True)     # hPa
    cloudcover_pct = models.FloatField(null=True)           # %
    visibility_m = models.FloatField(null=True)             # meters
    weather_code = models.IntegerField(null=True)           # WMO code
    precipitation_mm = models.FloatField(null=True)         # mm
    windspeed_10m_ms = models.FloatField(null=True)         # m/s
    soil_temperature_6cm_c = models.FloatField(null=True)   # °C

    raw = models.JSONField(blank=True, null=True)           # full Open-Meteo response (debug)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'waqi_temp_readings'
        indexes = [
            models.Index(fields=['created_at']),
            models.Index(fields=['station', 'created_at']),
            models.Index(fields=['observed_iso']),
        ]
        unique_together = (('station', 'observed_iso'),)

    def __str__(self):
        return f"Temp({self.station_id}, {self.temp_c}°C @ {self.observed_iso})"