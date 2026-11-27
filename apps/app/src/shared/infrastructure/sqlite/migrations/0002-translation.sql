CREATE TABLE translation (
  source_hash TEXT NOT NULL,
  direction TEXT NOT NULL,
  glossary_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  configured_model TEXT NOT NULL,   -- '' khi cấu hình không khai báo --model
  text TEXT NOT NULL,
  model TEXT,                       -- model thực tế từ output CLI
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_hash, direction, glossary_version, prompt_version, configured_model)
) STRICT, WITHOUT ROWID;
