"use strict";
// Table metadata for the Administrative Performance system.
// One definition feeds: the SQL migration (ddl()), the Postgres store (column whitelist) and the in-memory test store.
const TIMESTAMP = "TIMESTAMPTZ NOT NULL DEFAULT now()";
const T = {};
const table = (name, cols, o = {}) => {
  T[name] = { cols, unique: o.unique || [], pk: o.pk || null, indexes: o.indexes || [] };
};
const FK = (t, extra = "") => `INTEGER NOT NULL REFERENCES ${t}(id) ON DELETE CASCADE${extra}`;

table("administrative_offices", {
  id: "SERIAL PRIMARY KEY",
  code: "TEXT NOT NULL UNIQUE",
  name: "TEXT NOT NULL UNIQUE",
  short_name: "TEXT",
  purpose: "TEXT",
  active: "BOOLEAN NOT NULL DEFAULT TRUE",
  sort_order: "INTEGER NOT NULL DEFAULT 0",
  created_at: TIMESTAMP,
});
table("office_responsibilities", {
  id: "SERIAL PRIMARY KEY",
  office_id: FK("administrative_offices"),
  position: "INTEGER NOT NULL DEFAULT 0",
  text: "TEXT NOT NULL",
  active: "BOOLEAN NOT NULL DEFAULT TRUE",
}, { indexes: [["office_id"]] });
table("office_kpis", {
  id: "SERIAL PRIMARY KEY",
  office_id: FK("administrative_offices"),
  name: "TEXT NOT NULL",
  description: "TEXT",
  measurement_type: "TEXT NOT NULL DEFAULT 'PERCENTAGE' CHECK (measurement_type IN ('PERCENTAGE','NUMBER','YES_NO','RATING_10','COMPLETION_RATE','DEADLINE','QUALITY'))",
  target: "NUMERIC NOT NULL DEFAULT 100 CHECK (target >= 0)",
  frequency: "TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (frequency IN ('WEEKLY','MONTHLY','QUARTERLY'))",
  weight: "NUMERIC NOT NULL DEFAULT 10 CHECK (weight >= 0)",
  evidence_required: "BOOLEAN NOT NULL DEFAULT FALSE",
  auto_source: "TEXT",
  active: "BOOLEAN NOT NULL DEFAULT TRUE",
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
}, { unique: [["office_id", "name"]], indexes: [["office_id"]] });
table("kpi_results", {
  id: "SERIAL PRIMARY KEY",
  kpi_id: FK("office_kpis"),
  staff_id: FK("staff"),
  month: "CHAR(7) NOT NULL",
  actual: "NUMERIC",
  rating: "NUMERIC CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10))",
  evidence: "TEXT",
  comment: "TEXT",
  entered_by: "TEXT",
  updated_at: TIMESTAMP,
}, { unique: [["kpi_id", "staff_id", "month"]], indexes: [["staff_id", "month"]] });
table("meetings", {
  id: "SERIAL PRIMARY KEY",
  title: "TEXT NOT NULL",
  meeting_date: "DATE NOT NULL",
  meeting_time: "TIME",
  location: "TEXT",
  meeting_type: "TEXT NOT NULL DEFAULT 'GENERAL'",
  agenda: "TEXT",
  notes: "TEXT",
  action_points: "JSONB NOT NULL DEFAULT '[]'::jsonb",
  created_by: "TEXT",
  created_at: TIMESTAMP,
}, { indexes: [["meeting_date"]] });
table("admin_tasks", {
  id: "SERIAL PRIMARY KEY",
  title: "TEXT NOT NULL",
  description: "TEXT",
  office_id: "INTEGER REFERENCES administrative_offices(id) ON DELETE SET NULL",
  created_by: "TEXT",
  priority: "TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH'))",
  start_date: "DATE",
  due_date: "DATE NOT NULL",
  expected_output: "TEXT",
  kpi_id: "INTEGER REFERENCES office_kpis(id) ON DELETE SET NULL",
  meeting_id: "INTEGER REFERENCES meetings(id) ON DELETE SET NULL",
  cancelled: "BOOLEAN NOT NULL DEFAULT FALSE",
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
}, { indexes: [["due_date"], ["office_id"]] });
table("task_assignments", {
  id: "SERIAL PRIMARY KEY",
  task_id: FK("admin_tasks"),
  staff_id: FK("staff"),
  status: "TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','IN_PROGRESS','SUBMITTED','VERIFIED','COMPLETED','CANCELLED'))",
  actual_output: "TEXT",
  evidence_url: "TEXT",
  submitted_at: "TIMESTAMPTZ",
  submitted_date: "DATE",
  completion_date: "DATE",
  verification_status: "TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED'))",
  verified_by: "TEXT",
  verified_at: "TIMESTAMPTZ",
  management_comment: "TEXT",
  performance_score: "NUMERIC CHECK (performance_score IS NULL OR (performance_score >= 0 AND performance_score <= 100))",
  updated_at: TIMESTAMP,
}, { unique: [["task_id", "staff_id"]], indexes: [["staff_id", "status"]] });
table("task_evidence", {
  id: "SERIAL PRIMARY KEY",
  assignment_id: FK("task_assignments"),
  kind: "TEXT NOT NULL DEFAULT 'URL' CHECK (kind IN ('URL','NOTE','FILE'))",
  reference: "TEXT NOT NULL",
  description: "TEXT",
  added_by: "TEXT",
  created_at: TIMESTAMP,
}, { indexes: [["assignment_id"]] });
table("admin_activities", {
  id: "SERIAL PRIMARY KEY",
  staff_id: FK("staff"),
  office_id: "INTEGER REFERENCES administrative_offices(id) ON DELETE SET NULL",
  activity_date: "DATE NOT NULL",
  activity: "TEXT NOT NULL",
  description: "TEXT",
  task_id: "INTEGER REFERENCES admin_tasks(id) ON DELETE SET NULL",
  minutes_spent: "INTEGER CHECK (minutes_spent IS NULL OR minutes_spent >= 0)",
  output: "TEXT",
  evidence: "TEXT",
  status: "TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED'))",
  review_status: "TEXT NOT NULL DEFAULT 'UNREVIEWED' CHECK (review_status IN ('UNREVIEWED','REVIEWED','FLAGGED'))",
  reviewed_by: "TEXT",
  reviewed_at: "TIMESTAMPTZ",
  review_comment: "TEXT",
  created_at: TIMESTAMP,
}, { indexes: [["staff_id", "activity_date"]] });
table("admin_attendance", {
  id: "SERIAL PRIMARY KEY",
  staff_id: FK("staff"),
  office_id: "INTEGER REFERENCES administrative_offices(id) ON DELETE SET NULL",
  date: "DATE NOT NULL",
  event_type: "TEXT NOT NULL DEFAULT 'WORK' CHECK (event_type IN ('WORK','OFFICE','MEETING','MANDATORY_MEETING','TRAINING','EVENT','OFFICIAL_ASSIGNMENT'))",
  event_title: "TEXT NOT NULL DEFAULT ''",
  expected_time: "TIME",
  arrival_time: "TIME",
  departure_time: "TIME",
  status: "TEXT NOT NULL CHECK (status IN ('PRESENT','LATE','ABSENT','EXCUSED','OFFICIAL_ASSIGNMENT'))",
  late_minutes: "INTEGER NOT NULL DEFAULT 0",
  remark: "TEXT",
  meeting_id: "INTEGER REFERENCES meetings(id) ON DELETE SET NULL",
  recorded_by: "TEXT",
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
}, { unique: [["staff_id", "date", "event_type", "event_title"]], indexes: [["staff_id", "date"]] });
table("meeting_attendance", {
  id: "SERIAL PRIMARY KEY",
  meeting_id: FK("meetings"),
  staff_id: FK("staff"),
  required: "BOOLEAN NOT NULL DEFAULT TRUE",
  status: "TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PRESENT','LATE','ABSENT','EXCUSED'))",
  arrival_time: "TIME",
  remark: "TEXT",
  recorded_by: "TEXT",
  recorded_at: "TIMESTAMPTZ",
}, { unique: [["meeting_id", "staff_id"]], indexes: [["staff_id"]] });
table("weekly_reports", {
  id: "SERIAL PRIMARY KEY",
  staff_id: FK("staff"),
  office_id: "INTEGER REFERENCES administrative_offices(id) ON DELETE SET NULL",
  week_start: "DATE NOT NULL",
  activities: "TEXT",
  tasks_completed: "TEXT",
  tasks_pending: "TEXT",
  challenges: "TEXT",
  achievements: "TEXT",
  evidence: "TEXT",
  next_priorities: "TEXT",
  status: "TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED'))",
  submitted_at: "TIMESTAMPTZ",
  on_time: "BOOLEAN",
  reviewed_by: "TEXT",
  reviewed_at: "TIMESTAMPTZ",
  review_comment: "TEXT",
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
}, { unique: [["staff_id", "week_start"]], indexes: [["week_start", "status"]] });
table("deliverables", {
  id: "SERIAL PRIMARY KEY",
  staff_id: FK("staff"),
  office_id: "INTEGER REFERENCES administrative_offices(id) ON DELETE SET NULL",
  title: "TEXT NOT NULL",
  deliverable_type: "TEXT",
  description: "TEXT",
  task_id: "INTEGER REFERENCES admin_tasks(id) ON DELETE SET NULL",
  expected_date: "DATE NOT NULL",
  status: "TEXT NOT NULL DEFAULT 'EXPECTED' CHECK (status IN ('EXPECTED','SUBMITTED','APPROVED','REJECTED'))",
  submitted_at: "TIMESTAMPTZ",
  submitted_date: "DATE",
  late: "BOOLEAN NOT NULL DEFAULT FALSE",
  evidence_url: "TEXT",
  reviewed_by: "TEXT",
  reviewed_at: "TIMESTAMPTZ",
  review_comment: "TEXT",
  quality_rating: "NUMERIC CHECK (quality_rating IS NULL OR (quality_rating >= 0 AND quality_rating <= 10))",
  created_by: "TEXT",
  created_at: TIMESTAMP,
}, { indexes: [["staff_id", "expected_date"], ["status"]] });
table("performance_settings", {
  key: "TEXT PRIMARY KEY",
  value: "JSONB NOT NULL",
  updated_by: "TEXT",
  updated_at: TIMESTAMP,
}, { pk: ["key"] });
table("performance_months", {
  month: "CHAR(7) PRIMARY KEY",
  status: "TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED'))",
  closed_by: "TEXT",
  closed_at: "TIMESTAMPTZ",
  reopened_by: "TEXT",
  reopened_at: "TIMESTAMPTZ",
  reopen_reason: "TEXT",
  close_notes: "JSONB",
}, { pk: ["month"] });
table("performance_inputs", {
  id: "SERIAL PRIMARY KEY",
  staff_id: FK("staff"),
  month: "CHAR(7) NOT NULL",
  teamwork_rating: "NUMERIC CHECK (teamwork_rating IS NULL OR (teamwork_rating >= 0 AND teamwork_rating <= 10))",
  teamwork_comment: "TEXT",
  set_by: "TEXT",
  updated_at: TIMESTAMP,
}, { unique: [["staff_id", "month"]] });
table("performance_reviews", {
  id: "SERIAL PRIMARY KEY",
  staff_id: FK("staff"),
  month: "CHAR(7) NOT NULL",
  office_id: "INTEGER REFERENCES administrative_offices(id) ON DELETE SET NULL",
  status: "TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINALIZED','CLOSED'))",
  base_salary: "INTEGER NOT NULL DEFAULT 0",
  final_score: "NUMERIC NOT NULL DEFAULT 0",
  band: "TEXT",
  payment_percentage: "NUMERIC",
  payment_status: "TEXT",
  recommended_pay: "INTEGER NOT NULL DEFAULT 0",
  approved_pay: "INTEGER",
  approved_by: "TEXT",
  approved_at: "TIMESTAMPTZ",
  approval_reason: "TEXT",
  incomplete: "BOOLEAN NOT NULL DEFAULT FALSE",
  data_quality: "JSONB NOT NULL DEFAULT '{}'::jsonb",
  exit_review_required: "BOOLEAN NOT NULL DEFAULT FALSE",
  calculated_at: TIMESTAMP,
  finalized_by: "TEXT",
  finalized_at: "TIMESTAMPTZ",
}, { unique: [["staff_id", "month"]], indexes: [["month", "status"]] });
table("performance_components", {
  id: "SERIAL PRIMARY KEY",
  review_id: FK("performance_reviews"),
  component: "TEXT NOT NULL",
  weight: "NUMERIC NOT NULL DEFAULT 0",
  effective_weight: "NUMERIC",
  raw_score: "NUMERIC",
  points: "NUMERIC",
  overridden: "BOOLEAN NOT NULL DEFAULT FALSE",
  details: "JSONB NOT NULL DEFAULT '{}'::jsonb",
}, { unique: [["review_id", "component"]] });
table("performance_overrides", {
  id: "SERIAL PRIMARY KEY",
  staff_id: FK("staff"),
  month: "CHAR(7) NOT NULL",
  component: "TEXT NOT NULL",
  value: "NUMERIC NOT NULL CHECK (value >= 0 AND value <= 100)",
  reason: "TEXT NOT NULL",
  set_by: "TEXT",
  set_at: TIMESTAMP,
}, { unique: [["staff_id", "month", "component"]] });
table("performance_history", {
  id: "SERIAL PRIMARY KEY",
  staff_id: "INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT",
  month: "CHAR(7) NOT NULL",
  version: "INTEGER NOT NULL DEFAULT 1",
  office_id: "INTEGER",
  task_score: "NUMERIC",
  kpi_score: "NUMERIC",
  attendance_score: "NUMERIC",
  report_score: "NUMERIC",
  productivity_score: "NUMERIC",
  teamwork_score: "NUMERIC",
  final_score: "NUMERIC NOT NULL",
  band: "TEXT",
  salary: "INTEGER",
  recommended_pay: "INTEGER",
  approved_pay: "INTEGER",
  payment_status: "TEXT",
  snapshot: "JSONB",
  created_by: "TEXT",
  created_at: TIMESTAMP,
}, { unique: [["staff_id", "month", "version"]], indexes: [["month"]] });
table("performance_comments", {
  id: "SERIAL PRIMARY KEY",
  staff_id: FK("staff"),
  month: "CHAR(7)",
  kind: "TEXT NOT NULL DEFAULT 'COMMENT' CHECK (kind IN ('COMMENT','WARNING','REVIEW_NOTE','DECISION'))",
  decision: "TEXT",
  text: "TEXT NOT NULL",
  author: "TEXT",
  created_at: TIMESTAMP,
}, { indexes: [["staff_id", "month"]] });
table("performance_audit_logs", {
  id: "SERIAL PRIMARY KEY",
  actor: "TEXT",
  action: "TEXT NOT NULL",
  entity: "TEXT",
  entity_id: "TEXT",
  staff_id: "INTEGER",
  month: "CHAR(7)",
  old_value: "JSONB",
  new_value: "JSONB",
  reason: "TEXT",
  created_at: TIMESTAMP,
}, { indexes: [["staff_id", "created_at"], ["month"]] });
table("performance_alerts", {
  id: "SERIAL PRIMARY KEY",
  staff_id: FK("staff"),
  office_id: "INTEGER",
  month: "CHAR(7) NOT NULL",
  kind: "TEXT NOT NULL",
  severity: "TEXT NOT NULL DEFAULT 'WARNING' CHECK (severity IN ('INFO','WARNING','CRITICAL'))",
  message: "TEXT NOT NULL",
  ref: "TEXT NOT NULL DEFAULT ''",
  resolved: "BOOLEAN NOT NULL DEFAULT FALSE",
  resolved_by: "TEXT",
  resolved_at: "TIMESTAMPTZ",
  acknowledged_by: "TEXT",
  acknowledged_at: "TIMESTAMPTZ",
  created_at: TIMESTAMP,
  last_seen_at: TIMESTAMP,
}, { unique: [["staff_id", "month", "kind", "ref"]], indexes: [["month", "resolved"]] });
table("staff_access", {
  staff_id: "INTEGER PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE",
  code_salt: "TEXT NOT NULL",
  code_hash: "TEXT NOT NULL",
  created_by: "TEXT",
  created_at: TIMESTAMP,
  last_used_at: "TIMESTAMPTZ",
}, { pk: ["staff_id"] });
// Private access codes for the login page: one for the administrator ("ADMIN") and one per office ("OFFICE:<office code>").
// Only a salted scrypt hash is stored; the code itself can never be read back.
table("access_codes", {
  key: "TEXT PRIMARY KEY",
  scope: "TEXT NOT NULL CHECK (scope IN ('ADMIN','OFFICE'))",
  office_id: "INTEGER REFERENCES administrative_offices(id) ON DELETE CASCADE",
  code_salt: "TEXT NOT NULL",
  code_hash: "TEXT NOT NULL",
  created_by: "TEXT",
  created_at: TIMESTAMP,
  last_used_at: "TIMESTAMPTZ",
}, { pk: ["key"] });
table("office_title_map", {
  id: "SERIAL PRIMARY KEY",
  pattern: "TEXT NOT NULL UNIQUE",
  office_code: "TEXT NOT NULL",
  suggested: "BOOLEAN NOT NULL DEFAULT FALSE",
});

// Existing SAP2 tables (created by schema.sql). Listed so the data layer can read them; never created or altered here
// except the staff.office_id / payments columns added in ddl().
const EXISTING = {
  staff: { cols: { id: "SERIAL PRIMARY KEY", name: "TEXT NOT NULL UNIQUE", email: "TEXT", phone: "TEXT", bank: "TEXT", account_number: "TEXT", staff_type: "TEXT NOT NULL", role: "TEXT NOT NULL DEFAULT 'Instructor'", campuses: "TEXT[]", skills: "TEXT[]", frequency: "TEXT", per_appearance_rate: "INTEGER NOT NULL DEFAULT 20000", monthly_salary: "INTEGER", active: "BOOLEAN NOT NULL DEFAULT TRUE", created_at: TIMESTAMP, office_id: "INTEGER" }, unique: [], indexes: [] },
  payments: { cols: { id: "SERIAL PRIMARY KEY", staff_id: "INTEGER NOT NULL", pay_type: "TEXT NOT NULL", month: "CHAR(7) NOT NULL", amount: "INTEGER NOT NULL", reference: "TEXT NOT NULL", paid_at: TIMESTAMP, base_salary: "INTEGER", performance_score: "NUMERIC", recommended_pay: "INTEGER", approved_pay: "INTEGER" }, unique: [], indexes: [] },
};

const SCHEMA_VERSION = 2;

// Idempotent migration SQL. Existing tables/data are never dropped or rewritten.
function ddlStatements() {
  const out = [];
  for (const [name, t] of Object.entries(T)) {
    const cols = Object.entries(t.cols).map(([c, d]) => `  "${c}" ${d}`);
    for (const u of t.unique) cols.push(`  UNIQUE (${u.map((c) => `"${c}"`).join(", ")})`);
    out.push(`CREATE TABLE IF NOT EXISTS ${name} (\n${cols.join(",\n")}\n);`);
    for (const ix of t.indexes) out.push(`CREATE INDEX IF NOT EXISTS ${name}_${ix.join("_")}_idx ON ${name} (${ix.map((c) => `"${c}"`).join(", ")});`);
  }
  out.push(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS office_id INTEGER REFERENCES administrative_offices(id) ON DELETE SET NULL;`);
  out.push(`CREATE INDEX IF NOT EXISTS staff_office_idx ON staff (office_id);`);
  for (const [c, d] of [["base_salary", "INTEGER"], ["performance_score", "NUMERIC"], ["recommended_pay", "INTEGER"], ["approved_pay", "INTEGER"]])
    out.push(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ${c} ${d};`);
  out.push(`CREATE OR REPLACE FUNCTION performance_history_immutable() RETURNS trigger AS $fn$
BEGIN RAISE EXCEPTION 'performance_history is append-only (monthly snapshots are never changed)'; END;
$fn$ LANGUAGE plpgsql;`);
  out.push(`DROP TRIGGER IF EXISTS performance_history_guard ON performance_history;`);
  out.push(`CREATE TRIGGER performance_history_guard BEFORE UPDATE OR DELETE ON performance_history FOR EACH ROW EXECUTE FUNCTION performance_history_immutable();`);
  return out;
}
const ddl = () => ddlStatements().join("\n");

module.exports = { T, EXISTING, ALL: { ...T, ...EXISTING }, ddl, ddlStatements, SCHEMA_VERSION };
