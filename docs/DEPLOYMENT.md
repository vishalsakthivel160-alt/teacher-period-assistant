# Deployment

The backend serves both the API and the frontend, so you only deploy one service.

## Any Node host (Render, Railway, a VPS, etc.)

1. Set environment variables: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `PORT`, `BASE_URL`.
2. Build/run command:
   ```bash
   cd backend && npm install && npm start
   ```
3. Point the host to the exposed `PORT`.

## MongoDB

Use a managed MongoDB (for example MongoDB Atlas) in production and put the
connection string in `MONGO_URL`. Make sure the host's IP is allow-listed.

## Environment variables

| Variable    | Description                                   |
|-------------|-----------------------------------------------|
| MONGO_URL   | MongoDB connection string                     |
| DB_NAME     | Database name                                 |
| JWT_SECRET  | Secret for signing auth tokens                |
| PORT        | Port to listen on                             |
| BASE_URL    | Public base URL for generated links           |

## Health check

`GET /api` returns `{ "message": "Teacher Period Assistant API", "status": "ok" }`.
