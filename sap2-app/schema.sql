-- SAP2 schema (Neon / Postgres). Safe to re-run.
CREATE TABLE IF NOT EXISTS staff (
  id                     SERIAL PRIMARY KEY,
  name                   TEXT NOT NULL UNIQUE,
  email                  TEXT,
  phone                  TEXT,
  bank                   TEXT,
  account_number         TEXT,
  staff_type             TEXT NOT NULL CHECK (staff_type IN ('instructor','admin','both')),
  role                   TEXT NOT NULL DEFAULT 'Instructor',
  campuses               TEXT[] NOT NULL DEFAULT '{}',
  skills                 TEXT[] NOT NULL DEFAULT '{}',
  frequency              TEXT,                       -- e.g. 'Twice a week'
  per_appearance_rate    INTEGER NOT NULL DEFAULT 20000 CHECK (per_appearance_rate >= 0),
  monthly_salary         INTEGER CHECK (monthly_salary IS NULL OR monthly_salary >= 0),
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appearances (
  id           SERIAL PRIMARY KEY,
  staff_id     INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  campus       TEXT NOT NULL,
  rate         INTEGER NOT NULL,                     -- rate frozen at time of recording
  recorded_by  TEXT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, date, campus)
);
CREATE INDEX IF NOT EXISTS appearances_date_idx ON appearances (date);

-- pay_type: 'instructor' (per appearance) or 'admin' (monthly salary)
CREATE TABLE IF NOT EXISTS bonuses (
  staff_id  INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  pay_type  TEXT NOT NULL CHECK (pay_type IN ('instructor','admin')),
  month     CHAR(7) NOT NULL,                        -- 'YYYY-MM'
  amount    INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (staff_id, pay_type, month)
);

CREATE TABLE IF NOT EXISTS payments (
  id         SERIAL PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  pay_type   TEXT NOT NULL CHECK (pay_type IN ('instructor','admin')),
  month      CHAR(7) NOT NULL,
  amount     INTEGER NOT NULL,
  reference  TEXT NOT NULL UNIQUE,
  paid_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, pay_type, month)
);
