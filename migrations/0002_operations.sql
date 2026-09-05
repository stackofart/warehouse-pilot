-- Additive migration: existing catalog and users are preserved.
ALTER TABLE products ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN image_key TEXT;
ALTER TABLE users ADD COLUMN operational_role TEXT CHECK (operational_role IS NULL OR operational_role = 'replenisher');

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  document_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('photo', 'manual', 'json', 'legacy', 'wms1')),
  external_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  assigned_to TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'assigned', 'in-progress', 'paused', 'completed')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX orders_external_id ON orders(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX orders_assigned ON orders(assigned_to, updated_at);
CREATE TABLE picking_sessions (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  document_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_mutation_id TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE TABLE operation_receipts (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  entity_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE picking_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  event_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX picking_events_order ON picking_events(order_id, recorded_at);
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT REFERENCES products(id),
  sku TEXT NOT NULL,
  barcode TEXT NOT NULL,
  product_name TEXT NOT NULL,
  address TEXT NOT NULL,
  suggested_address TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('missing', 'moved', 'damaged', 'comment')),
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'checking-reserve', 'replenishing', 'ready', 'resolved', 'rejected')),
  author_id TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX reports_product ON reports(sku, status, updated_at);
CREATE INDEX reports_queue ON reports(kind, status, created_at);
CREATE TABLE stock_balances (
  product_id TEXT NOT NULL REFERENCES products(id),
  location TEXT NOT NULL,
  storage_level TEXT NOT NULL CHECK (storage_level IN ('pick', 'reserve')),
  quantity_units REAL CHECK (quantity_units >= 0),
  source TEXT NOT NULL CHECK (source IN ('manual', 'simulated', 'wms1')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, location, storage_level)
);
CREATE TABLE ai_usage (
  actor_id TEXT NOT NULL REFERENCES users(id),
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (actor_id, bucket)
);
