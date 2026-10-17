CREATE TABLE apk_releases (
    id SERIAL PRIMARY KEY,
    version_name VARCHAR(50) NOT NULL,
    version_code INT NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    release_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
