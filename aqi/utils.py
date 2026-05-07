
import requests
from django.conf import settings

WAQI_MAP_BOUNDS_URL = (
    f"https://api.waqi.info/map/bounds/?token={settings.WAQI_TOKEN}&latlng={settings.WAQI_BBOX}"
)
DETAILS_URL = "https://api.waqi.info/feed/@{uid}/?token={token}"

class WaqiError(Exception):
    pass

def fetch_bounds():
    r = requests.get(WAQI_MAP_BOUNDS_URL, timeout=20)
    data = r.json()
    if data.get('status') != 'ok':
        raise WaqiError(data)
    return data['data']

def fetch_details(uid: int):
    url = DETAILS_URL.format(uid=uid, token=settings.WAQI_TOKEN)
    r = requests.get(url, timeout=20)
    data = r.json()
    if data.get('status') != 'ok':
        raise WaqiError(data)
    return data['data']
