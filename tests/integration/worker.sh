#!/usr/bin/env bash
# Integration check of worker scheduling against a real Postgres (DATABASE_URL), with fetch stubbed.
# Usage: DATABASE_URL=postgres://... bash tests/integration/worker.sh   (needs psql, tsx)
set -euo pipefail
cd "$(dirname "$0")/../.."
Q() { psql "$DATABASE_URL" -tAc "$1"; }
fail() { echo "FAIL: $*"; exit 1; }
eq() { [ "$1" = "$2" ] || fail "$3 (expected '$2', got '$1')"; echo "ok: $3"; }
export STUB_FILE=$(mktemp) NODE_OPTIONS="--import ./tests/integration/stubfetch.mjs" WORKER_CONCURRENCY=3 MAX_FAILURES=12
run() { npx tsx src/worker.ts --once >/tmp/worker.log 2>&1 || { cat /tmp/worker.log; fail "worker crashed"; }; }
board() { # $1 = number of jobs
  python3 - "$1" > "$STUB_FILE.jobs" <<'PY'
import json,sys
n=int(sys.argv[1])
print(json.dumps([{"id":str(i),"title":f"Job {i}","content":"<p>x</p>","location":{"name":"Berlin"},"location_type":"remote","absolute_url":f"https://jobs.gem.com/acme/{i}","first_published_at":"2026-11-01T00:00:00Z"} for i in range(1,n+1)]))
PY
  python3 - "$STUB_FILE" "$STUB_FILE.jobs" <<'PY'
import json,sys
body=json.load(open(sys.argv[2]))
json.dump({"https://api.gem.com/job_board/v0/acme/job_posts/":{"status":200,"body":body},"https://api.gem.com/job_board/v0/gone/job_posts/":{"status":404,"body":"nope"}},open(sys.argv[1],"w"))
PY
}
Q "TRUNCATE jobs, sources RESTART IDENTITY"
Q "INSERT INTO sources (platform, company_slug, enabled, validation_status) VALUES ('gem','acme',TRUE,'valid'),('gem','gone',TRUE,'valid'),('gem','unvalidated',FALSE,'unvalidated')"

board 2; run
eq "$(Q "SELECT count(*) FROM jobs WHERE status='open'")" 2 "first crawl saves 2 open jobs"
eq "$(Q "SELECT unchanged_count FROM sources WHERE company_slug='acme'")" 0 "changed crawl resets unchanged_count"
eq "$(Q "SELECT next_run_at > now() FROM sources WHERE company_slug='acme'")" t "acme rescheduled into the future"
eq "$(Q "SELECT failure_count||'/'||permanent_failures FROM sources WHERE company_slug='gone'")" 1/1 "404 counts as failure + permanent"
eq "$(Q "SELECT last_seen IS NULL FROM sources WHERE company_slug='unvalidated'")" t "disabled source never crawled"
run
eq "$(Q "SELECT unchanged_count FROM sources WHERE company_slug='acme'")" 0 "not due yet: second run does nothing"

Q "UPDATE sources SET next_run_at=now()"; run
eq "$(Q "SELECT unchanged_count FROM sources WHERE company_slug='acme'")" 1 "identical content increments unchanged_count"
eq "$(Q "SELECT count(*) FROM jobs WHERE status='open'")" 2 "unchanged crawl keeps jobs open (touch path)"

board 1; Q "UPDATE sources SET next_run_at=now()"; run
eq "$(Q "SELECT count(*)||'/'||count(*) FILTER (WHERE status='closed') FROM jobs")" 2/1 "removed job closed, 1 still open"
eq "$(Q "SELECT unchanged_count FROM sources WHERE company_slug='acme'")" 0 "change resets unchanged_count"

Q "UPDATE sources SET next_run_at=now()"; run
eq "$(Q "SELECT enabled||'/'||coalesce(disabled_reason,'') FROM sources WHERE company_slug='gone'")" false/gone "3 consecutive 404s disable the source"

# stale handling: acme stops succeeding for > STALE_DAYS
Q "UPDATE sources SET last_success=now()-interval '10 days' WHERE company_slug='acme'"
npx tsx -e "import('./src/maintenance.ts').then(async m=>{console.log('closed',await m.closeStaleJobs(7));process.exit(0)})" 2>&1 | tail -1
eq "$(Q "SELECT count(*) FROM jobs WHERE status='open'")" 0 "stale source's jobs are closed"
eq "$(Q "SELECT snapshot_hash IS NULL FROM sources WHERE company_slug='acme'")" t "stale source hash cleared so next crawl does a full save"
Q "UPDATE sources SET next_run_at=now()"; run
eq "$(Q "SELECT count(*) FROM jobs WHERE status='open'")" 1 "recovered source re-opens its job via full save"

Q "UPDATE jobs SET status='closed', last_seen=now()-interval '100 days'"
npx tsx -e "import('./src/maintenance.ts').then(async m=>{console.log('purged',await m.purgeClosedJobs(90));process.exit(0)})" 2>&1 | tail -1
eq "$(Q "SELECT count(*) FROM jobs")" 0 "old closed jobs purged"
# --- detail cache (BambooHR): a changed crawl must only fetch details for new jobs ---
export STUB_LOG=$(mktemp)
bamboo() { # $1 = number of jobs on the board
  python3 - "$STUB_FILE" "$1" <<'PY'
import json,sys
n=int(sys.argv[2])
m={"https://cachetest.bamboohr.com/careers/list":{"status":200,"body":{"result":[{"id":i,"jobOpeningName":f"Role {i}","departmentLabel":"Ops","location":{"city":"Austin","state":"TX"}} for i in range(1,n+1)]}}}
for i in range(1,n+1):
    m[f"https://cachetest.bamboohr.com/careers/{i}/detail"]={"status":200,"body":{"result":{"jobOpening":{"description":f"<p>desc {i}</p>","datePosted":"2026-11-01"}}}}
json.dump(m,open(sys.argv[1],"w"))
PY
}
detail_calls() { grep -c '/detail$' "$STUB_LOG" || true; }
Q "TRUNCATE jobs, sources RESTART IDENTITY"
Q "INSERT INTO sources (platform, company_slug, enabled, validation_status) VALUES ('bamboohr','cachetest',TRUE,'valid')"
bamboo 2; : > "$STUB_LOG"; run
eq "$(detail_calls)" 2 "bamboohr first crawl fetches both details"
eq "$(Q "SELECT count(*) FROM jobs WHERE detail_fetched_at IS NOT NULL")" 2 "detail_fetched_at persisted for both jobs"
eq "$(Q "SELECT count(*) FROM jobs WHERE description_html LIKE '<p>desc %'")" 2 "descriptions stored"
bamboo 3; : > "$STUB_LOG"; Q "UPDATE sources SET next_run_at=now()"; run
eq "$(detail_calls)" 1 "changed crawl (1 new job) fetches only the new job's detail"
eq "$(Q "SELECT count(*) FROM jobs WHERE status='open' AND description_html LIKE '<p>desc %'")" 3 "cached descriptions survive the changed crawl"
Q "UPDATE jobs SET detail_fetched_at = now() - interval '30 days' WHERE external_id='1'"
bamboo 3; : > "$STUB_LOG"; Q "UPDATE sources SET next_run_at=now()"; run
eq "$(detail_calls)" 1 "a detail past DETAIL_TTL_HOURS is refetched (and only that one)"
unset STUB_LOG

echo "ALL PASSED"
