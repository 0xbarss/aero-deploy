CREATE TABLE apps (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    package_name VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX apps_name_lower_key ON apps (lower(name));

-- At most one app may have no package name: the default app that receives uploads without one
CREATE UNIQUE INDEX apps_single_default_key ON apps ((package_name IS NULL)) WHERE package_name IS NULL;
