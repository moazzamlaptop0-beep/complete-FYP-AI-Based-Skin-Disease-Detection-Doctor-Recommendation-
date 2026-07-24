import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# 1. .env file load karein
load_dotenv()

# 2. .env se DATABASE_URL read karein
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

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