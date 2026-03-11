CREATE SCHEMA IF NOT EXISTS source_schema;
CREATE SCHEMA IF NOT EXISTS target_schema;

CREATE TABLE IF NOT EXISTS source_schema.users (
  id INTEGER PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  age INTEGER,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS target_schema.users (
  id INTEGER PRIMARY KEY,
  name VARCHAR(80),
  age INTEGER,
  created_at TIMESTAMP
);

TRUNCATE TABLE source_schema.users RESTART IDENTITY;
TRUNCATE TABLE target_schema.users RESTART IDENTITY;

INSERT INTO source_schema.users (id, name, age, created_at)
VALUES
  (1, 'alice', 30, TIMESTAMP '2024-01-01 00:00:00'),
  (2, 'bob', 41, TIMESTAMP '2024-02-15 00:00:00'),
  (3, 'carol', 35, TIMESTAMP '2024-03-22 00:00:00'),
  (4, 'dan', 28, TIMESTAMP '2024-05-09 00:00:00');

INSERT INTO target_schema.users (id, name, age, created_at)
VALUES
  (1, 'pre_existing', 99, TIMESTAMP '2024-01-10 00:00:00');
