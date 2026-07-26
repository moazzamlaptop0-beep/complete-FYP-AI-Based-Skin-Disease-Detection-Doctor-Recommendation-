"""
Database seeds.

Run through the Flask CLI so they get the real app config:

    flask seed-root      # the single root admin  (idempotent)
    flask seed-demo      # demo doctor + patient  (idempotent)

Both are safe to run repeatedly: re-running updates the existing row instead of
inserting a duplicate or raising on the unique email constraint.
"""

__all__ = ["seed_root_admin", "seed_demo"]
