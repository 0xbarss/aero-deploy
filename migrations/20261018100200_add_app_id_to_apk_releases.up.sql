INSERT INTO apps (name) VALUES ('Default App') ON CONFLICT DO NOTHING;

ALTER TABLE apk_releases ADD COLUMN app_id INT REFERENCES apps(id) ON DELETE RESTRICT;
UPDATE apk_releases SET app_id = (SELECT id FROM apps WHERE package_name IS NULL);
ALTER TABLE apk_releases ALTER COLUMN app_id SET NOT NULL;

-- The constraint name is PostgreSQL's default, but look it up instead of assuming it
DO $$
DECLARE
    old_constraint TEXT;
BEGIN
    SELECT c.conname INTO old_constraint
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'apk_releases'::regclass
       AND c.contype = 'u'
       AND array_length(c.conkey, 1) = 1
       AND a.attname = 'version_code';
    IF old_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE apk_releases DROP CONSTRAINT %I', old_constraint);
    END IF;
END $$;

ALTER TABLE apk_releases ADD CONSTRAINT apk_releases_app_version_key UNIQUE (app_id, version_code);
