-- Fails, and changes nothing, if two apps already share a version_code
ALTER TABLE apk_releases DROP CONSTRAINT apk_releases_app_version_key;
ALTER TABLE apk_releases ADD CONSTRAINT apk_releases_version_code_key UNIQUE (version_code);
ALTER TABLE apk_releases DROP COLUMN app_id;
