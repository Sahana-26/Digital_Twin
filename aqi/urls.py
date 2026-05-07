
from django.urls import path
from .views import index
from . import views
urlpatterns = [
    path('', index, name='home'),
    path("api/aqi/hourly/", views.aqi_hourly_metrics, name="aqi_hourly_metrics"),
    path(
        "api/aqi/stations/hourly/",
        views.aqi_station_hourly_timeseries,
        name="aqi_station_hourly_timeseries",
    ),
    
]
