-- Rename ball_in_court_* columns to entity_* for terminology consistency.
--
-- The app's domain glossary canonicalized the responsible-party concept as
-- "Entity" (previously "Ball in Court"). Application code, UI, and the Excel
-- export column already use "Entity"; this migration brings the database in
-- line. RENAME COLUMN preserves all existing row data.
--
-- Affected tables: document_annotations (highlight annotation rows) and
-- survey_items.

ALTER TABLE document_annotations RENAME COLUMN ball_in_court_entity_id TO entity_id;
ALTER TABLE document_annotations RENAME COLUMN ball_in_court_name TO entity_name;

ALTER TABLE survey_items RENAME COLUMN ball_in_court_entity_id TO entity_id;
ALTER TABLE survey_items RENAME COLUMN ball_in_court_name TO entity_name;
