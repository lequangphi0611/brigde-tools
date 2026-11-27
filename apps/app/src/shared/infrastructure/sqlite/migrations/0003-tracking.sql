CREATE TABLE tracked_project (
  id TEXT NOT NULL PRIMARY KEY,        -- '<ownerType>:<owner>/<number>'
  owner TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('org', 'user')),
  number INTEGER NOT NULL,
  baselined_at TEXT,                   -- NULL = chưa lấy mốc
  last_polled_at TEXT
) STRICT;

CREATE TABLE issue (
  id TEXT NOT NULL PRIMARY KEY,        -- GitHub node id
  project_id TEXT NOT NULL REFERENCES tracked_project (id),
  gh_updated_at TEXT NOT NULL,         -- chuỗi GitHub trả về; so bằng Date.parse
  closed INTEGER NOT NULL CHECK (closed IN (0, 1)),
  contents_loaded INTEGER NOT NULL CHECK (contents_loaded IN (0, 1)),
  repo TEXT,                           -- NULL khi chưa lấy chi tiết (issue chỉ có mốc)
  number INTEGER,
  url TEXT,
  assignees TEXT                       -- JSON mảng login
) STRICT;
CREATE INDEX issue_project_id ON issue (project_id);

CREATE TABLE content (
  id TEXT NOT NULL PRIMARY KEY,        -- ContentId: title:<issue> / body:<issue> / comment:<commentNodeId>
  issue_id TEXT NOT NULL REFERENCES issue (id),
  kind TEXT NOT NULL CHECK (kind IN ('title', 'body', 'comment')),
  gh_id TEXT,                          -- node id comment; NULL cho title/body
  author TEXT,
  text TEXT NOT NULL,                  -- nguyên văn, không chuẩn hoá
  hash TEXT NOT NULL,                  -- sha256 hex của text
  gh_created_at TEXT,                  -- NULL cho title/body
  gh_updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX content_issue_id ON content (issue_id);
