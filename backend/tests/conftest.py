import os
import sys
from pathlib import Path

# Point settings at a dummy DB before anything imports core.config, so tests
# can never touch the real database from .env. No test opens a connection.
os.environ["DATABASE_URL"] = "postgresql+asyncpg://test:test@127.0.0.1:1/test"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["DATABASE_SSL"] = "disable"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
