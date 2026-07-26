"""
Background jobs.

Nothing here is imported eagerly: `app.jobs.scheduler` is pulled in by
create_app() only when config RUN_SCHEDULER is true, so importing the package
(tests, CLI, alembic) never starts a thread.
"""

__all__ = ["scheduler"]
