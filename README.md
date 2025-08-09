### Mock EOR Quote Server (Deel, Remote, Oyster)

Mock server that simulates EOR quote APIs for Deel, Remote, and Oyster. For demos and local testing only – no real provider interaction.

#### Tech
- Node 18+, TypeScript, Express, Zod, @faker-js/faker
- Jest + Supertest for tests
- Nodemon for dev

#### Endpoints (high-level)
- POST `/oauth/token`
- GET `/rest/v2/eor/additional-costs/:country`
- GET `/rest/v2/forms/eor/create-contract/:country`
- POST `/rest/v2/eor` (supports `?delay=true`)
- GET `/rest/v2/eor/contracts/:contract_id/details`
- Equivalent under `/remote/*` and `/oyster/*`
- Admin: POST `/mock/seed` to reload seed data
- GET `/quotes/compare?country=XX&salary=YYY&currency=ZZZ&role=ROLE`
- POST `/quotes/pdf` (body is the JSON returned by `/quotes/compare`)
- Swagger UI at `/docs`

#### Configuration
Environment variables (see defaults):
- `PORT` (default 3000)
- `MOCK_DELAY_MS` (default 300)
- `TERMINATION_MULTIPLIER` (default 0.5)

#### Quick start
1. Install: `npm install`
2. Dev server: `npm run dev`
3. Tests: `npm test`

#### Example requests
```bash
# Token
http POST :3000/oauth/token

# Country rules
http GET :3000/rest/v2/eor/additional-costs/US

# Form schema
http GET :3000/rest/v2/forms/eor/create-contract/US

# Immediate quote
http POST :3000/rest/v2/eor country=US salary:=100000 currency=USD role="Software Engineer" start_date=2025-01-01 benefits:='["healthcare"]'

# Delayed quote and details
ID=$(http --print=b :3000/rest/v2/eor\?delay=true country=US salary:=80000 currency=USD role="Software Engineer" start_date=2025-01-01 benefits:='["healthcare"]' | jq -r .contract_id)
http GET :3000/rest/v2/eor/contracts/$ID/details

# Compare providers
http GET :3000/quotes/compare country==US salary==120000 currency==USD role=="Software Engineer"

# Generate PDF
http POST :3000/quotes/pdf <(http GET :3000/quotes/compare country==US salary==120000 currency==USD role=="Software Engineer") --output quote.pdf
```

#### Docker
```bash
docker compose up --build
```

This is a mock server only; numbers are plausible but fabricated.


