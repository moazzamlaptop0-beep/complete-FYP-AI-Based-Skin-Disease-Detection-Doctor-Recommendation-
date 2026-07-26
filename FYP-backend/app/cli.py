"""
Flask CLI commands.

    flask seed-root        create/refresh the single root admin (idempotent)
    flask seed-demo        create a demo doctor + patient for manual testing
    flask routes-check     assert all 39 contract paths are registered
    flask db-tables        list the tables Postgres actually has

All of these run through the app factory, so they see the same config the
server does. Use them instead of ad-hoc scripts -- `python some_script.py`
would not have an app context and would silently fall back to env defaults.
"""

import click
from flask.cli import with_appcontext


def register_cli(app):
    app.cli.add_command(seed_root_command)
    app.cli.add_command(seed_demo_command)
    app.cli.add_command(routes_check_command)
    app.cli.add_command(db_tables_command)
    return app


@click.command("seed-root")
@click.option("--email", default=None, help="Overrides $ROOT_ADMIN_EMAIL.")
@click.option("--password", default=None, help="Overrides $ROOT_ADMIN_PASSWORD.")
@click.option("--name", default=None, help="Overrides $ROOT_ADMIN_NAME.")
@with_appcontext
def seed_root_command(email, password, name):
    """Create or refresh the root admin account. Safe to run repeatedly."""
    from seeds.seed_root_admin import seed_root_admin

    result = seed_root_admin(email=email, password=password, name=name)
    click.echo(result["message"])


@click.command("seed-demo")
@with_appcontext
def seed_demo_command():
    """Create a demo doctor (approved) and a demo patient for testing."""
    from seeds.seed_demo import seed_demo

    for line in seed_demo()["log"]:
        click.echo(line)


@click.command("routes-check")
@with_appcontext
def routes_check_command():
    """Verify every contract path is registered exactly once."""
    from flask import current_app

    rules = list(current_app.url_map.iter_rules())
    paths = sorted({r.rule for r in rules if r.endpoint != "static"})
    click.echo(f"{len(rules)} rules, {len(paths)} distinct paths")
    for path in paths:
        methods = sorted(
            m for r in rules if r.rule == path
            for m in r.methods if m not in ("HEAD", "OPTIONS")
        )
        click.echo(f"  {path:<50} {','.join(methods)}")


@click.command("db-tables")
@with_appcontext
def db_tables_command():
    """List the tables present in the connected database."""
    from sqlalchemy import inspect

    from app.core.db import get_engine

    inspector = inspect(get_engine())
    tables = sorted(inspector.get_table_names())
    click.echo(f"{len(tables)} tables:")
    for table in tables:
        cols = inspector.get_columns(table)
        click.echo(f"  {table:<32} ({len(cols)} columns)")


__all__ = ["register_cli"]
