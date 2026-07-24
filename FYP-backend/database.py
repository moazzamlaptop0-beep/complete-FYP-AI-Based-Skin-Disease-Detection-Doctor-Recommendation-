from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Database Connection URL
# Format: postgresql://username:password@localhost:port/database_name
SQLALCHEMY_DATABASE_URL = "postgresql://postgres:minemoazzam.57@localhost:5432/ai_derma_db"

# Engine create karna jo database se connect karega
engine = create_engine(SQLALCHEMY_DATABASE_URL)

# Database session banana
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Models banane ke liye Base class
Base = declarative_base()

# Ye function har request par naya database session banayega aur close karega
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()