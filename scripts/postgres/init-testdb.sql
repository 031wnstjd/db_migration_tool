CREATE SCHEMA IF NOT EXISTS source_schema;
CREATE SCHEMA IF NOT EXISTS target_schema;

DROP TABLE IF EXISTS source_schema.users CASCADE;
DROP TABLE IF EXISTS target_schema.users CASCADE;

CREATE TABLE source_schema.users (
  id INTEGER NOT NULL,
  name VARCHAR(80) NOT NULL,
  age INTEGER,
  created_at TIMESTAMP NOT NULL
) PARTITION BY RANGE (created_at);

CREATE TABLE source_schema.users_20240101 PARTITION OF source_schema.users
  FOR VALUES FROM ('2024-01-01 00:00:00') TO ('2024-01-02 00:00:00');

CREATE TABLE source_schema.users_20240215 PARTITION OF source_schema.users
  FOR VALUES FROM ('2024-02-15 00:00:00') TO ('2024-02-16 00:00:00');

CREATE TABLE source_schema.users_20240322 PARTITION OF source_schema.users
  FOR VALUES FROM ('2024-03-22 00:00:00') TO ('2024-03-23 00:00:00');

CREATE TABLE source_schema.users_20240509 PARTITION OF source_schema.users
  FOR VALUES FROM ('2024-05-09 00:00:00') TO ('2024-05-10 00:00:00');

CREATE INDEX idx_users_created_at ON source_schema.users (created_at);

CREATE TABLE target_schema.users (
  id INTEGER PRIMARY KEY,
  name VARCHAR(80),
  age INTEGER,
  created_at TIMESTAMP
);

TRUNCATE TABLE source_schema.users CASCADE;
TRUNCATE TABLE target_schema.users;

INSERT INTO source_schema.users (id, name, age, created_at)
VALUES
  (1, 'alice', 30, TIMESTAMP '2024-01-01 00:00:00'),
  (2, 'bob', 41, TIMESTAMP '2024-02-15 00:00:00'),
  (3, 'carol', 35, TIMESTAMP '2024-03-22 00:00:00'),
  (4, 'dan', 28, TIMESTAMP '2024-05-09 00:00:00');

INSERT INTO target_schema.users (id, name, age, created_at)
VALUES
  (1, 'pre_existing', 99, TIMESTAMP '2024-01-10 00:00:00');
