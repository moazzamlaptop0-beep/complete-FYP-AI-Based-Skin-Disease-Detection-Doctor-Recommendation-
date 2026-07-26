"""
Standalone maintenance scripts.

These are a package (rather than loose files) only so that tests can
`from scripts.seed_consent_docs import seed_consent_docs` and call the function
directly instead of shelling out to a subprocess.

Each script also runs on its own:

    .venv/Scripts/python.exe scripts/seed_consent_docs.py
"""

__all__ = ["seed_consent_docs"]
