-- Search and permission indexes.
--
-- Chinese has no whitespace, so Postgres' text-search dictionaries cannot
-- tokenise it; trigram indexes match zh and en from the same code path and
-- make the ILIKE/similarity predicates in lib/ai/retrieval.ts index scans
-- instead of sequential ones.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS files_name_trgm_idx ON files USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS files_text_trgm_idx ON files USING gin (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS files_tags_idx ON files USING gin (tags);

-- The permission predicate matches on the concatenated subject; indexing that
-- expression is what keeps a filtered list query flat as tuples grow.
CREATE INDEX IF NOT EXISTS tuples_subject_expr_idx
  ON relation_tuples ((subject_type || ':' || subject_id));

-- Files are almost always listed by folder path membership.
CREATE INDEX IF NOT EXISTS files_folder_path_idx ON files USING gin (folder_path);

-- Live (non-deleted) files are the hot set.
CREATE INDEX IF NOT EXISTS files_live_updated_idx ON files (updated_at DESC) WHERE deleted_at IS NULL;

-- Chat history is read tail-first, per channel.
CREATE INDEX IF NOT EXISTS chat_messages_tail_idx ON chat_messages (channel_id, created_at DESC) WHERE deleted_at IS NULL;
