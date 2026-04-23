-- This file runs automatically when Docker starts the postgres container for the first time.
-- It enables the pgvector extension required for storing knowledge chunk embeddings.
-- Do not remove this file.
CREATE EXTENSION IF NOT EXISTS vector;
