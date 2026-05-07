
import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'change-me-in-production')
DEBUG = os.getenv('DEBUG', 'true').lower() == 'true'
ALLOWED_HOSTS = os.getenv('ALLOWED_HOSTS', '127.0.0.1,localhost').split(',')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'aqi',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'cesium_aqi.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'aqi' / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'cesium_aqi.wsgi.application'
ASGI_APPLICATION = 'cesium_aqi.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.getenv('POSTGRES_DB', 'twin_smartcity'),
        'USER': os.getenv('POSTGRES_USER', 'postgres'),
        'PASSWORD': os.getenv('POSTGRES_PASSWORD', 'MPPL@1984'),
        'HOST': os.getenv('POSTGRES_HOST', '106.51.185.107'),
        'PORT': os.getenv('POSTGRES_PORT', '5432'),
    }
}

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'aqi' / 'static']

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True

WAQI_TOKEN = os.getenv('WAQI_TOKEN', '23cd9192ec0991d0f50a546b77202bf31fc8bdfd')
WAQI_BBOX = os.getenv('WAQI_BBOX', '51.0,-0.6,51.8,0.5')
CESIUM_ION_TOKEN = os.getenv('CESIUM_ION_TOKEN', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzYTdmNGJjZS0yNzczLTQ2YzQtYTljOS03NmMwNzlkOWY4ZTAiLCJpZCI6MzE5NDk2LCJpYXQiOjE3NTE5NTk1Nzh9.SYVKEBbV-N8UeuAubHTDjLQtZEtznHNCkMSrPOctCLc')
