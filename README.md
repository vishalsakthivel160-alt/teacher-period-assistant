# Teacher Period Assistant

A secure, multi-tenant school / college portal for managing timetables, faculty,
students, attendance, assignments, leaves and substitutions. Data is stored in
MongoDB and persists across refresh, logout and server restarts.

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** MongoDB (single source of truth)
- **Frontend:** Single-page app (React via CDN + Tailwind), served by the backend

## Project Structure

```
teacher-period-assistant/
├── backend/
│   ├── server.js        # Express server + all API routes + MongoDB access
│   ├── package.json
│   └── .env.example
├── frontend/
│   └── index.html       # Single-page application
├── docs/
│   ├── API.md           # All API endpoints
│   ├── DATA_MODEL.md    # MongoDB document structure
│   ├── SETUP.md         # Local setup guide
│   └── DEPLOYMENT.md    # Deployment guide
└── README.md
```

## Quick Start

1. Install and run MongoDB locally (or use a MongoDB Atlas connection string).
2. Configure the backend:
   ```bash
   cd backend
   cp .env.example .env      # then edit .env with your MONGO_URL and JWT_SECRET
   npm install
   npm start
   ```
3. Open the app in your browser:
   ```
   http://localhost:3000
   ```

The backend serves the frontend on the same origin, so the app talks to the API
using relative `/api` paths with no extra configuration.

## Roles

- **Administrator** – creates the institution, departments, classes, subjects,
  teachers, periods, timetable, announcements; approves leaves; assigns
  substitutes and class tutors.
- **Teacher** – signs in with a 6-digit Teacher Code; views personal timetable,
  manages tutor-class students, takes attendance, posts assignments, applies for
  leave.
- **Student** – signs in with a Register Number; views attendance, timetable and
  assignments, and submits work.

## First-time Setup Flow

1. Open the app and click **Add Institution**. Choose a 5-digit code, admin
   username and a password (minimum 8 characters).
2. Create **Departments**, then **Classes** and **Subjects**.
3. Add **Teachers** (each is issued a 6-digit Teacher Code automatically).
4. Assign a **Class Tutor** using the teacher's code.
5. Configure **Periods** and build the **Timetable**.
6. Teachers and students can now sign in with their codes.

## License

MIT
