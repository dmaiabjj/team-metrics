# Azure DevOps Performance Report API

FastAPI service that pulls Azure DevOps work items for configured teams over a date range and returns a normalised performance report (deliverables with hierarchy and linked bugs/tasks).

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT
```

## Run

```bash
uvicorn app.main:app --reload
```

Base URL (local): `http://localhost:8000`

---

## Endpoints

### Health

**Request**

```
GET /health
```

No parameters.

**Response** `200 OK`

```json
{
  "status": "ok"
}
```

---

### Report (single team)

**Request**

```
GET /report?team_id={team_id}&start_date={start_date}&end_date={end_date}
```

| Parameter    | Type | Required | Description                          |
|-------------|------|----------|--------------------------------------|
| `team_id`   | string | Yes    | Team slug (e.g. `game-services`)      |
| `start_date`| date   | Yes    | Start of period, ISO (e.g. `2025-01-01`) |
| `end_date`  | date   | Yes    | End of period, ISO (e.g. `2025-01-31`)   |

**Example request**

```
GET http://localhost:8000/report?team_id=game-services&start_date=2025-01-01&end_date=2025-01-31
```

**Response** `200 OK`

```json
{
  "team_id": "game-services",
  "start_date": "2025-01-01",
  "end_date": "2025-01-31",
  "deliverables": [
    {
      "id": 12345,
      "work_item_type": "Story",
      "title": "Implement checkout flow",
      "description": "<div>Build the full checkout flow for payment processing.</div>",
      "state": "Closed",
      "canonical_status": "Delivered",
      "status_at_start": "Active",
      "status_at_end": "Closed",
      "status_timeline": [
        {"date": "2024-12-15T10:00:00Z", "state": "Active", "canonical_status": "Development Active", "assigned_to": "Alice Smith"},
        {"date": "2025-01-10T14:30:00Z", "state": "In QA", "canonical_status": "QA Active", "assigned_to": "Bob Jones"},
        {"date": "2025-01-20T09:00:00Z", "state": "Closed", "canonical_status": "Delivered", "assigned_to": "Carol White"}
      ],
      "parent_epic_title": null,
      "parent_feature_title": "Payment MVP",
      "child_bug_ids": [12346],
      "child_task_ids": [12347, 12348],
      "developer": "Alice Smith",
      "qa": "Bob Jones",
      "release_manager": "Carol White"
    },
    {
      "id": 12349,
      "work_item_type": "Task",
      "title": "Add unit tests",
      "description": null,
      "state": "In Progress",
      "canonical_status": "Development Active",
      "status_at_start": null,
      "status_at_end": "Active",
      "status_timeline": [
        {"date": "2025-01-05T08:00:00Z", "state": "Active", "canonical_status": "Development Active", "assigned_to": "Alice Smith"}
      ],
      "parent_epic_title": null,
      "parent_feature_title": null,
      "child_bug_ids": [],
      "child_task_ids": [],
      "developer": "Alice Smith",
      "qa": null,
      "release_manager": null
    }
  ]
}
```

**Error responses**

- `400` – `start_date` is after `end_date`
  ```json
  { "detail": "start_date must be <= end_date" }
  ```
- `404` – Unknown `team_id`
  ```json
  { "detail": "Unknown team_id: foo. Known: ['game-services', 'domain-tooling-services', ...]" }
  ```
- `503` – Azure DevOps not configured (missing org or PAT)
  ```json
  { "detail": "Azure DevOps not configured: set AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT" }
  ```

---

### Report (multiple teams)

**Request**

```
GET /report/multi?team_ids={team_ids}&start_date={start_date}&end_date={end_date}
```

| Parameter    | Type | Required | Description                                   |
|-------------|------|----------|-----------------------------------------------|
| `team_ids`  | string | Yes    | Comma-separated team slugs                     |
| `start_date`| date   | Yes    | Start of period, ISO (e.g. `2025-01-01`)      |
| `end_date`  | date   | Yes    | End of period, ISO (e.g. `2025-01-31`)        |

**Example request**

```
GET http://localhost:8000/report/multi?team_ids=game-services,payment-services&start_date=2025-01-01&end_date=2025-01-31
```

**Response** `200 OK`

```json
{
  "teams": [
    {
      "team_id": "game-services",
      "deliverables": [
        {
          "id": 12345,
          "work_item_type": "Story",
          "title": "Implement checkout flow",
          "description": "<div>Build the full checkout flow.</div>",
          "state": "Closed",
          "canonical_status": "Delivered",
          "status_at_start": "Active",
          "status_at_end": "Closed",
          "status_timeline": [
            {"date": "2024-12-15T10:00:00Z", "state": "Active", "canonical_status": "Development Active", "assigned_to": "Alice Smith"},
            {"date": "2025-01-20T09:00:00Z", "state": "Closed", "canonical_status": "Delivered", "assigned_to": "Carol White"}
          ],
          "parent_epic_title": null,
          "parent_feature_title": "Payment MVP",
          "child_bug_ids": [12346],
          "child_task_ids": [12347, 12348],
          "developer": "Alice Smith",
          "qa": "Bob Jones",
          "release_manager": "Carol White"
        }
      ]
    },
    {
      "team_id": "payment-services",
      "deliverables": [
        {
          "id": 12400,
          "work_item_type": "Story",
          "title": "Refund API",
          "description": "Implement refund processing via API.",
          "state": "In Testing",
          "canonical_status": "QA Active",
          "status_at_start": "Active",
          "status_at_end": "In QA",
          "status_timeline": [
            {"date": "2024-12-20T11:00:00Z", "state": "Active", "canonical_status": "Development Active", "assigned_to": "Dave Brown"},
            {"date": "2025-01-15T16:00:00Z", "state": "In QA", "canonical_status": "QA Active", "assigned_to": "Eve Green"}
          ],
          "parent_epic_title": null,
          "parent_feature_title": "Refunds",
          "child_bug_ids": [],
          "child_task_ids": [12401],
          "developer": "Dave Brown",
          "qa": "Eve Green",
          "release_manager": null
        }
      ]
    }
  ]
}
```

**Error responses**

- `400` – `start_date` is after `end_date`
  ```json
  { "detail": "start_date must be <= end_date" }
  ```
- `404` – One or more unknown `team_id`s
  ```json
  { "detail": "Unknown team_id(s): ['foo']" }
  ```
- `503` – Azure DevOps not configured (same as single-team report)

---

## Status Timeline & Period Boundaries

Each deliverable includes:

| Field | Description |
|-------|-------------|
| `description` | Work item description (HTML or plain text as stored in Azure DevOps) |
| `status_at_start` | State of the item at the beginning of the queried period (`null` if created after) |
| `status_at_end` | State of the item at the end of the queried period |
| `status_timeline` | Chronological list of state transitions, each with `date`, `state`, `canonical_status`, and `assigned_to` |

The timeline only includes revisions where the state actually changed (consecutive duplicates are skipped).

---

## Role Assignment

Each deliverable includes three role fields computed from revision history:

| Field | Logic |
|-------|-------|
| `developer` | Person assigned for the longest time during **Development Active** states |
| `qa` | Person assigned for the longest time during **QA Active** states |
| `release_manager` | Person assigned for the longest time during **Delivered** states |

Values are `null` when no one was assigned during the corresponding phase.

---

## Config

Edit `app/config/teams.yaml` to set project, area_paths, deliverable_types, container_types, bug_types, and state mappings per team. The five default teams are: **game-services**, **domain-tooling-services**, **payment-services**, **player-engagement-services**, **rules-engine**.

**Canonical statuses** (each maps from real Azure DevOps states; configurable per team in `states`):

| Canonical status     | Example real states |
|----------------------|----------------------|
| Development Active   | Active, Onhold, Blocked, Code Review |
| QA Active            | Ready for QA, In QA, QA bug pending |
| Delivered            | Release Candidate, Closed, Resolved |
| Backlog              | New, Ready |

---

## Postman

Import `postman_collection.json` into Postman to run the same requests. Set the `base_url` variable (e.g. `http://localhost:8000`) and optionally add env vars for query params.
