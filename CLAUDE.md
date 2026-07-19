# etzhayyim-project-supplychain — Cleaning Robot Manufacturing Supply Chain

> **Runtime**: K8s pod-side LangServer / MCP / LangGraph Pregel. Cloudflare edge is UI and proxy only.

`supplychain.etzhayyim.com` analyzes upstream material pressure and supply-chain stress across the cleaning robot manufacturing graph. It is a domain actor within the Jukyu System-of-Systems: it normalizes automotive material and robotics package tables into the shared Jukyu SoS schema and runs Pregel pressure-propagation over that domain slice.

## App Identity

| Key | Value |
|---|---|
| **nanoid** | `supplychain001` |
| **DID** | `did:web:supplychain.etzhayyim.com` |
| **Runtime** | `k8s-langserver` |
| **Graph** | `supplychain_cleaning_robot_v1` |
| **Domain** | `cleaning_robot` |

## Graph Contract

Supplychain writes to the shared Jukyu SoS tables with `domain = 'cleaning_robot'`:

- `vertex_jukyu_supply_node` — normalized material / assembly / supplier nodes.
- `vertex_jukyu_balance_observation` — observed supply/demand balance per material × country.
- `vertex_jukyu_company_exposure` — company-level pressure scores from Pregel.
- `vertex_jukyu_notification_signal` — notification outbox populated by Pregel write_signals.
- `edge_jukyu_supply_dependency` — dependency edges (supplier → material, material → assembly).
- `edge_jukyu_company_operates_node` — company-to-node operation edges.

No dedicated supplychain-specific tables exist. All rows carry `domain = 'cleaning_robot'` and `source_table` values referencing the robotics/automotive upstream sources.

## Adapter Sources

`normalize_cleaning_robot()` reads from existing automotive and robotics materialized views:

| Source Table | Node Kind |
|---|---|
| `vertex_automotive_material_requirement` | `material` supply nodes |
| `vertex_robotics_product_package` | `assembly` supply nodes |
| `edge_automotive_material_supplied_by` | `supplier` supply nodes + supplier→material edges |
| `edge_automotive_package_requires_material` | material→assembly (package) dependency edges |

The adapter is idempotent: all `cleaning_robot` rows are deleted before re-insert (delete-then-insert, no `ON CONFLICT`).

## Pregel

Primary graph: `supplychain_cleaning_robot_v1`

| Constant | Value |
|---|---|
| `_MAX_ITER` | 8 supersteps |
| `_HALT_DELTA` | 0.03 (convergence threshold) |
| `_DAMPING` | 0.70 (per-hop decay) |
| `_DEFAULT_DOMAIN` | `cleaning_robot` |

DAG: `init_run → read_balance → read_chain → propagate ←(loop)→ write_signals → read_summary → END`

Pressure initialisation seeds nodes whose `balance_quantity < 0` relative to `demand_quantity`. Propagation walks upstream (material → supplier) with exponential damping. Company exposure is scored as a weighted combination of supply, demand, downstream, and structural pressure. Risk scores are capped at 0.95.

## Resident Behavior

The pod runs 3 in-process cron tasks:

| Task | Interval | Handler |
|---|---|---|
| `equilibrium` | 15 min | Full Pregel run over `cleaning_robot` domain |
| `outbox-drain` | 15 min | Log pending signals from `mv_jukyu_notification_outbox` |
| `cleaning-robot` | 24 h | `normalize_cleaning_robot()` adapter refresh |

First fire is after one interval (not at boot). Cron is controlled by `LG_CRON_ENABLED` env var (default `true`).

## Server Surface

FastAPI server at port 8000, uvicorn single-worker (single asyncio event loop required for in-process cron).

| Endpoint | Purpose |
|---|---|
| `GET /health`, `GET /ok` | Liveness / readiness |
| `GET /graphs` | Lists `supplychain_cleaning_robot_v1` |
| `POST /runs` | Manual graph invocation |
| `POST /cron/equilibrium` | Trigger equilibrium run |
| `POST /cron/domain-adapter/cleaning-robot` | Trigger adapter refresh |
| `POST /cron/outbox-drain` | Inspect notification outbox |

Auth: `LG_SUPPLYCHAIN_API_KEY` env var. Unset = unauthenticated access allowed (dev/test). Set = `x-api-key` header required for all mutating endpoints.

## Env Vars

| Var | Default | Purpose |
|---|---|---|
| `SUPPLYCHAIN_DOMAIN` | `cleaning_robot` | Domain filter for equilibrium and outbox-drain |
| `SUPPLYCHAIN_RISK_THRESHOLD` | `0.55` | Minimum risk score to emit a signal |
| `SUPPLYCHAIN_MAX_BALANCE_ROWS` | `100` | Balance observation read limit |
| `SUPPLYCHAIN_MAX_CHAIN_ROWS` | `500` | Supply-chain edge read limit |
| `SUPPLYCHAIN_MAX_EXPOSURE_ROWS` | `250` | Exposure write limit |
| `LG_SUPPLYCHAIN_API_KEY` | unset | Auth token; unset = open |
| `LG_CRON_ENABLED` | `true` | Enable in-process cron tasks |
| `PSYCOPG_CONNSTRING` | — | RisingWave connection string (injected by Helm) |

## K8s / Helm

Helm release: `lg-supplychain-pool` in namespace `mitama-udf`
Chart: `50-infra/vultr/lg-supplychain-pool/`
Image: `ghcr.io/etzhayyim/lg-supplychain:0.1.0-amd64`
Dockerfile: `40-engine/kotoba/crates/kotoba-kotodama/py/Dockerfile.supplychain`

Build:
```bash
cd 40-engine/kotoba/crates/kotoba-kotodama/py
docker buildx build \
  -f Dockerfile.supplychain \
  -t ghcr.io/etzhayyim/lg-supplychain:0.1.0-amd64 \
  --push .
```

## MCP Dispatch

Registered in `mcp_dispatch.py` under `com.etzhayyim.apps.supplychain.*`:

| MCP Method | Pod Endpoint |
|---|---|
| `runEquilibrium` | `POST /cron/equilibrium` |
| `drainOutbox` | `POST /cron/outbox-drain` |
| `adaptCleaningRobot` | `POST /cron/domain-adapter/cleaning-robot` |

## Relation to Jukyu

Supplychain is a **domain contributor** to Jukyu. It does not have its own graph schema or Pregel constants independent of Jukyu — it writes `domain='cleaning_robot'` rows into the shared Jukyu SoS tables. The Jukyu global equilibrium graph (`jukyu_global_equilibrium_v1`) can then include the cleaning robot domain in its cross-domain pressure propagation.

Supplychain's Pregel (`supplychain_cleaning_robot_v1`) runs a domain-scoped propagation pass independently of Jukyu, so the cleaning robot material graph can be analyzed on its own cadence without waiting for a full global run.

## Tests

All tests are DB-free and use `unittest.mock.patch`:

| Test File | Coverage |
|---|---|
| `tests/test_cleaning_robot_adapter.py` | `normalize_cleaning_robot()` shape, DB calls, idempotency, error propagation |
| `tests/test_supplychain_graph.py` | Pure algorithm functions: `_init_pressures_from_balance`, `_propagate_pressure_step`, `_compute_company_exposures`, `should_continue`, `build_graph()` |
| `tests/test_supplychain_server.py` | All FastAPI endpoints via TestClient + AsyncMock |
| `tests/test_supplychain_pregel.py` | Pregel superstep integration (pure data, no DB) |
