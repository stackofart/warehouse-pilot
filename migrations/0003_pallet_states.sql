CREATE TABLE pallet_states (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  document_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_mutation_id TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
