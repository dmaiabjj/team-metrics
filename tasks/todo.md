# Azure DevOps Performance Report API – Tasks

- [x] Project scaffold (requirements.txt, app layout, main.py, settings)
- [x] Config: teams.yaml + Pydantic loader for all 5 teams
- [x] Azure DevOps client: WIQL, Revisions, Work Items with Relations
- [x] Report service: inclusion logic and enrichment
- [x] API: GET /report route and schemas
- [x] .env.example and verification

## Review

Implementation complete per plan. Run: `uvicorn app.main:app --reload`. Call `GET /report?team_id=game-services&start_date=2025-01-01&end_date=2025-01-31` (with AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT set).
