# API Reference

Base path: `/api`. All non-auth endpoints require the header
`Authorization: Bearer <token>` returned at login.

## Auth

| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET  | /auth/institutions | – | Public list of institutions |
| POST | /auth/create-institution-admin | institution_code, username, password, confirmPassword | Creates institution + admin, returns token |
| POST | /auth/login | institutionCode, username, password | Admin login |
| POST | /auth/teacher-login | institutionCode, teacherCode | Teacher login |
| POST | /auth/student-login | institutionCode, registerNumber | Student login |
| POST | /auth/forgot-password | institutionCode, recoveryEmail | Returns reset link |
| GET  | /auth/teacher/timetable | – (teacher) | Personal timetable + institution |
| GET  | /auth/teacher/announcements | – (teacher) | Announcements for teacher departments |

## Admin (admin token)

| Method | Path | Notes |
|--------|------|-------|
| GET  | /admin/institution | Full institution document |
| PUT  | /admin/institution-name | Set institution name |
| POST | /admin/institution/settings | Update settings |
| POST | /admin/periods | Save periods array |
| POST | /admin/timetable | Save full timetable |
| POST/DELETE | /admin/departments[/:id] | Create / delete department |
| POST/DELETE | /admin/classes[/:id] | Create / delete class |
| POST | /admin/classes/:id/tutor | Assign class tutor by teacherCode |
| POST/DELETE | /admin/subjects[/:id] | Create / delete subject |
| POST/PUT/DELETE | /admin/teachers[/:id] | Manage teachers |
| POST | /admin/teachers/:id/registration-link | Device registration link |
| DELETE | /admin/devices/:id | Remove a registered device |
| GET/POST/PUT/DELETE | /admin/announcements[/:id] | Manage announcements |
| GET | /admin/leaves | List leave requests |
| PUT | /admin/leaves/:id/approve | Approve (auto-creates substitutions) |
| PUT | /admin/leaves/:id/reject | Reject |
| GET | /admin/substitutions?status= | List substitutions |
| GET | /admin/substitutions/:id/candidates | Ranked substitute candidates |
| POST | /admin/substitutions/:id/assign | Assign substitute |
| PUT | /admin/substitutions/:id/cancel | Cancel substitution |

## Teacher (teacher token)

| Method | Path | Notes |
|--------|------|-------|
| GET | /teacher/classes | Classes/subjects taught |
| GET | /teacher/tutor-classes | Classes where teacher is tutor |
| GET/POST/PUT/DELETE | /teacher/students[/:id] | Manage tutor-class students |
| GET/POST | /teacher/attendance | Read / save period attendance |
| GET/POST | /teacher/assignments | List / create assignments |
| POST | /teacher/confirm-assignment | Verify a student submission |
| GET/POST/DELETE | /teacher/leaves[/:id] | Manage own leaves |
| GET | /teacher/substitutions | Assigned substitutions |

## Student (student token)

| Method | Path | Notes |
|--------|------|-------|
| GET | /student/my-data | Profile, attendance, assignments |
| POST | /student/submit-assignment | Submit work |

## Devices

| Method | Path | Notes |
|--------|------|-------|
| GET | /push/code-info?code= | Verify a Teacher Code |
| POST | /push/register-code-device | Register a device |
| POST | /push/test-notification | Send a test notification |
