# AI Dermatologist - backend image
#
# The previous CMD was `uvicorn main:app` -- leftover from a FastAPI scaffold.
# There is no main.py and uvicorn is not a dependency, so this image could
# never have started. It now boots the Flask app through run.py.
#
# For a real deployment use a WSGI server instead (gunicorn is NOT in
# requirements.txt because it does not run on the Windows dev machine):
#   pip install gunicorn
#   gunicorn -w 4 -k gthread --threads 8 -b 0.0.0.0:7860 wsgi:app
# Read the SSE and scheduler warnings in wsgi.py before choosing worker counts.

FROM python:3.11-slim

WORKDIR /code

# Build deps for psycopg2 / pillow wheels that lack a slim manylinux build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libpq-dev \
 && rm -rf /var/lib/apt/lists/*

COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860 \
    FLASK_DEBUG=0 \
    RUN_SCHEDULER=false

EXPOSE 7860

# Alembic owns the schema; run `alembic upgrade head` as a release step, not
# from the container entrypoint (it must not race across replicas).
CMD ["python", "run.py"]
