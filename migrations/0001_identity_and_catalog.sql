PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'picker')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT,
  brand TEXT,
  net_content TEXT,
  units_per_box REAL,
  case_barcode TEXT,
  item_length_cm REAL,
  item_width_cm REAL,
  item_height_cm REAL,
  item_weight_kg REAL,
  box_length_cm REAL,
  box_width_cm REAL,
  box_height_cm REAL,
  box_weight_kg REAL,
  box_max_top_load_kg REAL,
  rigidity REAL,
  fragility REAL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified', 'unverified')),
  verification_source TEXT NOT NULL DEFAULT 'imported',
  verified_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  deleted_at TEXT
);

CREATE UNIQUE INDEX products_active_sku ON products(sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX products_active_barcode ON products(barcode) WHERE deleted_at IS NULL;
CREATE INDEX products_location ON products(location) WHERE deleted_at IS NULL;
CREATE INDEX products_updated_at ON products(updated_at) WHERE deleted_at IS NULL;

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX audit_log_created_at ON audit_log(created_at);
CREATE INDEX audit_log_actor ON audit_log(actor_id, created_at);
