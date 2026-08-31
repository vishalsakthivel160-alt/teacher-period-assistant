# Local Setup

## Prerequisites

- Node.js 18 or newer
- MongoDB 6 or newer (local install or a MongoDB Atlas cluster)

## Steps

1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd teacher-period-assistant/backend
   ```

2. Create your environment file:
   ```bash
   cp .env.example .env
   ```
   Edit `.env`:
   - `MONGO_URL` – e.g. `mongodb://localhost:27017` or your Atlas URI
   - `DB_NAME` – e.g. `teacher_period_assistant`
   - `JWT_SECRET` – a long random string
   - `PORT` – default `3000`

3. Install dependencies and start:
   ```bash
   npm install
   npm start
   ```

4. Visit `http://localhost:3000`.

## Notes

- The database and its collections are created automatically on first write.
- All identifiers are UUID strings.
- Passwords are hashed with scrypt; login tokens are signed with HMAC-SHA256.
