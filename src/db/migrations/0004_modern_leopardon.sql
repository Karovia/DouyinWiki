-- FTS5 virtual table for BM25 full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
  content,
  content='chunks',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Trigger: sync chunks table to fts_chunks
CREATE TRIGGER IF NOT EXISTS fts_chunks_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO fts_chunks(rowid, content, chunk_id, video_id, workspace_id, content_type)
  VALUES (new.rowid, new.content, new.id, new.video_id, new.workspace_id, new.content_type);
END;

CREATE TRIGGER IF NOT EXISTS fts_chunks_delete AFTER DELETE ON chunks BEGIN
  INSERT INTO fts_chunks(fts_chunks, rowid, content, chunk_id, video_id, workspace_id, content_type)
  VALUES ('delete', old.rowid, old.content, old.id, old.video_id, old.workspace_id, old.content_type);
END;

CREATE TRIGGER IF NOT EXISTS fts_chunks_update AFTER UPDATE ON chunks BEGIN
  INSERT INTO fts_chunks(fts_chunks, rowid, content, chunk_id, video_id, workspace_id, content_type)
  VALUES ('delete', old.rowid, old.content, old.id, old.video_id, old.workspace_id, old.content_type);
  INSERT INTO fts_chunks(rowid, content, chunk_id, video_id, workspace_id, content_type)
  VALUES (new.rowid, new.content, new.id, new.video_id, new.workspace_id, new.content_type);
END;
