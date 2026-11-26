-- Migration: 001_add_composite_indexes
-- Composite indexes for product filtering, search, and analytics queries

-- Items filtered by category + not deleted, sorted by name (GET /items?category=X)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_category_name
  ON items (category_id, name) WHERE is_deleted = FALSE;

-- Items filtered by quantity vs threshold for stock status queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_stock_status
  ON items (quantity, threshold) WHERE is_deleted = FALSE;

-- SKU lookups (filtering by SKU in search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_sku
  ON items (sku) WHERE is_deleted = FALSE AND sku != '';

-- Transaction logs: item + action type for analytics consumption queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_txns_item_action_created
  ON transaction_logs (item_id, action_type, created_at DESC);

-- Alert logs: item + alert type + date for dedup checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_item_type_created
  ON alert_logs (item_id, alert_type, created_at DESC);

-- Users email lookup (login)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email
  ON users (email);

-- Refresh tokens: lookup by hash, exclude revoked
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_hash_active
  ON refresh_tokens (token_hash) WHERE revoked = FALSE;
