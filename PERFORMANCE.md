# Task filtering: EXPLAIN results

26 October 2026 · MySQL 8.0.46 · InnoDB

**Historical snapshot:** the results below describe the original
creator/assignee-only read scope, before the requested shared-workspace change.
Authenticated users can now read all tasks, so the current unfiltered query no
longer contains the ownership predicate. These measurements must not be treated
as current-query performance results. `npm run explain:filters` imports the
current query builder and can generate a new comparison; the saved JSON below
is retained as evidence of the original measurement.

## Behavior

`GET /api/tasks?status=done&priority=high&assignedTo=42` combines parameterized
SQL `WHERE` conditions. Existing `assignedTo=me`, search, omitted filters,
`{ tasks: [...] }`, newest-first ordering, and creator/assignee access remain
compatible. Numeric assignees are an extension. React requests filtered results;
it does not filter downloaded tasks.

Every query retains `(created_by = ? OR assigned_to = ?)`, then adds optional
status, priority, and assignee equalities. Invalid assignee IDs return 400;
valid IDs without accessible matches return an empty list.

## Index analysis

| Columns | Decision |
| --- | --- |
| `id`, `created_by`, `assigned_to` | Keep existing primary/ownership/foreign-key indexes. |
| `(status, priority)` | Added; chosen for tested status and combined filters. |
| `(assigned_to, status, priority)` | Added; chosen for the tested assignee + status + priority filter. |
| `(created_by, status, priority)` | Trial candidate not chosen in these plans; not installed. |
| `priority` alone | No added index; selected composites did not change priority-only access. A dedicated priority index was not benchmarked. |
| `created_at`, `due_date`, title, description | No additions: sorting remains; due-date filtering is absent; current `LOCATE` title search has no demonstrated B-tree benefit. |

[Composite indexes use leftmost prefixes](https://dev.mysql.com/doc/refman/8.0/en/multiple-column-indexes.html).
Low-cardinality status/priority values do not guarantee improvement. Additional
index storage and write-maintenance costs were not measured.

## Measurements

The real task table had **0 rows** before/after; it cannot establish a useful
performance result. Separate scratch tables held **30,000 synthetic tasks and
500 users**, seed `20261026`. User 1 created 5,947 tasks and was assigned 4,431;
2,985 tasks were done and 3,051 high priority. This deliberately busy user is
not a measured production workload.

Baseline: primary key and original ownership indexes. After: those plus the two
selected composites. Both phases ran `ANALYZE TABLE`, `EXPLAIN`, and
`EXPLAIN ANALYZE` on the API's actual query builder, including joins and ordering,
without index hints. Returned IDs and order matched before/after.

| Filters for user 1 | Estimated task rows before → after | Actual task candidates before → after | Returned |
| --- | ---: | ---: | ---: |
| None | 9,493 → 9,450 | 9,513 → 9,513 | 9,513 |
| Done | 9,493 → 2,985 | 9,513 → 2,985 | 959 |
| High priority | 9,493 → 9,450 | 9,513 → 9,513 | 974 |
| Done + high | 9,493 → 328 | 9,513 → 328 | 104 |
| Assigned to me | 4,431 → 4,431 | 4,431 → 4,431 | 4,431 |
| Me + done + high | 4,431 → 51 | 4,431 → 51 | 51 |

Estimates are EXPLAIN's `t.rows`, not measurements
([MySQL EXPLAIN documentation](https://dev.mysql.com/doc/refman/8.0/en/explain-output.html)).
Actual candidates are rows emitted by the task lookup/index-merge deduplication
iterator before residual filtering; they exclude index-leaf work, joins, and
sorting, so they are **not total rows examined**.

Selective queries switched to the new composites. Unfiltered, priority-only,
and a sparse user's combined query retained ownership indexes. Sorting remained
for the queries above. No latency, throughput, percentage speedup, or universal
improvement is claimed. Raw timings are single-run observations, not a controlled
benchmark; plans and estimates may vary on reruns.

## Reproduce

From `server/`:

```powershell
npm run explain:filters
npm run db:indexes
npm run test:tasks
```

EXPLAIN requires configured MySQL 8.0.18+ and scratch-table CREATE/ALTER/DROP
permissions. Only uniquely named scratch tables are seeded/altered/dropped;
live task data is untouched. Full SQL, parameters, trial/final plans, and live
before/after metadata are in [database/filter-explain-results.json](database/filter-explain-results.json).
Rerunning the benchmark regenerates its live snapshot and synthetic comparison.

The two indexes were applied locally; migration reruns were verified as safe.
New databases get them from `database/schema.sql`. API checks cover individual
and combined filters, numeric assignees, legacy `me`, ordering, and privacy.
