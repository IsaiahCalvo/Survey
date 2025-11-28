-- Remove duplicate templates based on config->>'id'
-- Keeps only the most recently created one for each duplicate

WITH ranked_templates AS (
  SELECT
    id,
    config->>'id' as template_id,
    ROW_NUMBER() OVER (
      PARTITION BY config->>'id'
      ORDER BY created_at DESC
    ) as rn
  FROM templates
  WHERE config->>'id' IS NOT NULL
)
DELETE FROM templates
WHERE id IN (
  SELECT id
  FROM ranked_templates
  WHERE rn > 1
);

-- Show remaining templates to verify
SELECT
  id,
  name,
  config->>'id' as template_id,
  created_at
FROM templates
ORDER BY created_at DESC;
