# Data Model

All data lives in a single MongoDB collection: **`institutions`**.
Each document represents one institution and embeds every sub-collection, which
keeps reads simple and writes atomic per institution.

```jsonc
{
  "id": "uuid",
  "institution_code": "12345",        // 5-digit code used at login
  "institution_name": "Christian College",
  "name": "Christian College",
  "claimed": true,
  "adminUsername": "admin",
  "adminPasswordHash": "salt:hash",    // scrypt
  "settings": {
    "notificationTiming": 0,
    "workingDays": ["mon","tue","wed","thu","fri"],
    "shortDayEnabled": false,
    "shortDay": "sat",
    "shortDayPeriodsCount": 4
  },
  "departments": [{ "id": "uuid", "name": "CSE" }],
  "classes":     [{ "id": "uuid", "name": "II-CSE", "departmentId": "uuid", "tutorTeacherId": "uuid" }],
  "subjects":    [{ "id": "uuid", "name": "DBMS", "departmentId": "uuid", "classId": "uuid" }],
  "teachers":    [{ "id": "uuid", "name": "John", "phone": "...", "teacherCode": "123456", "departmentIds": ["uuid"], "devices": [] }],
  "students":    [{ "id": "uuid", "name": "Alice", "registerNumber": "R001", "classId": "uuid", "year": "1st Year" }],
  "periods":     [{ "id": "p1", "label": "Period 1", "start": "09:00", "end": "09:50", "isBreak": false }],
  "timetable":   { "mon": [{ "periodId": "p1", "classId": "uuid", "subjectId": "uuid", "teacherId": "uuid" }] },
  "announcements": [{ "id": "uuid", "title": "...", "message": "...", "targetDepartments": ["uuid"], "createdAt": "iso" }],
  "leaves":        [{ "id": "uuid", "teacherId": "uuid", "fromDate": "...", "toDate": "...", "type": "full_day", "status": "Pending" }],
  "substitutions": [{ "id": "uuid", "classId": "uuid", "periodId": "p1", "status": "Pending", "substituteTeacherId": null }],
  "assignments":   [{ "id": "uuid", "classId": "uuid", "teacherId": "uuid", "title": "...", "submissions": [] }],
  "attendance":    [{ "id": "uuid", "classId": "uuid", "date": "2025-06-16", "periodId": "p1", "records": [{ "studentId": "uuid", "status": "present" }] }],
  "createdAt": "iso"
}
```

## Notes

- Class objects are returned with `tutorTeacherName` and `tutorTeacherCode`
  resolved from the current teacher record.
- `adminPasswordHash` is never returned by the API.
