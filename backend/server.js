/**
 * Teacher Period Assistant - Backend
 * Node.js + Express + MongoDB
 *
 * MongoDB is the single source of truth. One document per institution
 * (in the `institutions` collection) embeds all sub-collections
 * (departments, classes, subjects, teachers, students, timetable, etc.).
 *
 * This server also serves the single-page frontend from ../frontend so the
 * browser can call the API on the same origin using relative /api paths.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { randomUUID, randomBytes, createHmac, scryptSync, timingSafeEqual } = require('crypto');

require('dotenv').config();

const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'teacher_period_assistant';
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';
const BASE_URL = process.env.BASE_URL || '';

/* ---------------- MongoDB connection (cached) ---------------- */
let _db = null;
async function getDb() {
  if (_db) return _db;
  const client = new MongoClient(MONGO_URL, { maxPoolSize: 10 });
  await client.connect();
  _db = client.db(DB_NAME);
  console.log(`[db] connected to ${DB_NAME}`);
  return _db;
}
async function institutions() {
  const db = await getDb();
  return db.collection('institutions');
}
async function credentials() {
  const db = await getDb();
  return db.collection('biometric_credentials');
}

/* ---------------- Auth: HMAC JWT + scrypt hashing ---------------- */
const toB64Url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function signToken(payload) {
  const header = toB64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const bodyPart = toB64Url(JSON.stringify({ ...payload, iat: Date.now() }));
  const data = `${header}.${bodyPart}`;
  const sig = toB64Url(createHmac('sha256', JWT_SECRET).update(data).digest());
  return `${data}.${sig}`;
}

function verifyToken(token) {
  try {
    const [h, b, s] = (token || '').split('.');
    if (!h || !b || !s) return null;
    const data = `${h}.${b}`;
    const sig = toB64Url(createHmac('sha256', JWT_SECRET).update(data).digest());
    if (sig !== s) return null;
    return JSON.parse(Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch {
    return null;
  }
}

function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const h = scryptSync(pw, salt, 32).toString('hex');
  try {
    return timingSafeEqual(Buffer.from(h), Buffer.from(hash));
  } catch {
    return false;
  }
}

/* ---------------- Helpers ---------------- */
const DEFAULT_SETTINGS = {
  notificationTiming: 0,
  workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  shortDayEnabled: false,
  shortDay: 'sat',
  shortDayPeriodsCount: 4,
};

function newInstitution(code, username, passwordHash) {
  return {
    id: randomUUID(),
    institution_code: code,
    institution_name: '',
    name: `Institution (${code})`,
    claimed: true,
    adminUsername: username,
    adminPasswordHash: passwordHash,
    recoveryEmail: '',
    settings: { ...DEFAULT_SETTINGS },
    departments: [],
    classes: [],
    subjects: [],
    teachers: [],
    students: [],
    periods: [],
    timetable: {},
    announcements: [],
    leaves: [],
    substitutions: [],
    assignments: [],
    attendance: [],
    createdAt: new Date().toISOString(),
  };
}

function sanitize(inst) {
  if (!inst) return inst;
  const { adminPasswordHash, _id, ...rest } = inst;
  rest.departments = rest.departments || [];
  rest.subjects = rest.subjects || [];
  rest.teachers = (rest.teachers || []).map((t) => ({ ...t }));
  const byId = {};
  rest.teachers.forEach((t) => (byId[t.id] = t));
  rest.classes = (rest.classes || []).map((c) => {
    const t = c.tutorTeacherId ? byId[c.tutorTeacherId] : null;
    return { ...c, tutorTeacherName: t ? t.name : null, tutorTeacherCode: t ? t.teacherCode : null };
  });
  rest.students = rest.students || [];
  rest.periods = rest.periods || [];
  rest.timetable = rest.timetable || {};
  rest.announcements = rest.announcements || [];
  rest.leaves = rest.leaves || [];
  rest.substitutions = rest.substitutions || [];
  rest.assignments = rest.assignments || [];
  rest.attendance = rest.attendance || [];
  return rest;
}

async function saveInst(inst) {
  const col = await institutions();
  const { _id, ...doc } = inst;
  await col.replaceOne({ id: inst.id }, doc, { upsert: true });
}
async function findByCode(code) {
  const col = await institutions();
  return col.findOne({ institution_code: String(code || '').trim() });
}
async function findById(id) {
  const col = await institutions();
  return col.findOne({ id });
}

function genTeacherCode(inst) {
  const used = new Set((inst.teachers || []).map((t) => t.teacherCode));
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (used.has(code));
  return code;
}

const nameOf = (arr, id) => ((arr || []).find((x) => x.id === id) || {}).name || '';
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function periodMap(inst) {
  const m = {};
  (inst.periods || []).forEach((p) => (m[p.id] = p));
  return m;
}

function buildTeacherView(inst, teacherId) {
  const teacher = (inst.teachers || []).find((t) => t.id === teacherId);
  if (!teacher) return null;
  const pm = periodMap(inst);
  const timetable = {};
  const assignedClassIds = new Set();
  const assignedSubjectIds = new Set();
  Object.entries(inst.timetable || {}).forEach(([day, entries]) => {
    const mine = (entries || [])
      .filter((e) => e.teacherId === teacherId)
      .map((e) => {
        const p = pm[e.periodId] || {};
        assignedClassIds.add(e.classId);
        assignedSubjectIds.add(e.subjectId);
        return {
          ...e,
          startTime: p.start || '',
          endTime: p.end || '',
          periodLabel: p.label || e.periodId,
          className: nameOf(inst.classes, e.classId),
          subjectName: nameOf(inst.subjects, e.subjectId),
          roomName: e.roomName || '',
        };
      })
      .sort((a, b) => (a.startTime > b.startTime ? 1 : -1));
    timetable[day] = mine;
  });
  (inst.classes || []).forEach((c) => {
    if (c.tutorTeacherId === teacherId) assignedClassIds.add(c.id);
  });
  const deptIds = teacher.departmentIds && teacher.departmentIds.length ? teacher.departmentIds : (teacher.departmentId ? [teacher.departmentId] : []);
  return {
    teacher: {
      id: teacher.id,
      name: teacher.name,
      teacherCode: teacher.teacherCode,
      phone: teacher.phone || '',
      departmentNames: deptIds.map((d) => nameOf(inst.departments, d)).filter(Boolean),
      departmentName: nameOf(inst.departments, deptIds[0]) || 'General / All',
      assignedClasses: [...assignedClassIds].map((c) => nameOf(inst.classes, c)).filter(Boolean),
      assignedSubjects: [...assignedSubjectIds].map((s) => nameOf(inst.subjects, s)).filter(Boolean),
    },
    institution: sanitize(inst),
    timetable,
    periods: inst.periods || [],
  };
}

function generateSubstitutions(inst, leave) {
  const pm = periodMap(inst);
  const dayKey = DAY_KEYS[new Date(leave.fromDate + 'T00:00:00').getDay()] || 'mon';
  const dayEntries = (inst.timetable || {})[dayKey] || [];
  let entries = dayEntries.filter((e) => e.teacherId === leave.teacherId);
  if (leave.type === 'specific_period' && leave.periodId) {
    entries = entries.filter((e) => e.periodId === leave.periodId);
  }
  const subs = entries.map((e) => {
    const p = pm[e.periodId] || {};
    return {
      id: randomUUID(),
      leaveId: leave.id,
      date: leave.fromDate,
      teacherId: leave.teacherId,
      teacherName: leave.teacherName,
      classId: e.classId,
      className: nameOf(inst.classes, e.classId),
      subjectId: e.subjectId,
      subjectName: nameOf(inst.subjects, e.subjectId),
      periodId: e.periodId,
      periodLabel: p.label || e.periodId,
      startTime: p.start || '',
      endTime: p.end || '',
      roomName: e.roomName || '',
      status: 'Pending',
      substituteTeacherId: null,
      substituteTeacherName: null,
      createdAt: new Date().toISOString(),
    };
  });
  inst.substitutions = [...(inst.substitutions || []), ...subs];
  return subs;
}

function rankCandidates(inst, sub) {
  const dayKey = DAY_KEYS[new Date(sub.date + 'T00:00:00').getDay()] || 'mon';
  const dayEntries = (inst.timetable || {})[dayKey] || [];
  const busyTeacherIds = new Set(dayEntries.filter((e) => e.periodId === sub.periodId).map((e) => e.teacherId));
  const targetSubject = (inst.subjects || []).find((s) => s.id === sub.subjectId);
  const targetDept = targetSubject ? targetSubject.departmentId : null;

  return (inst.teachers || [])
    .filter((t) => t.id !== sub.teacherId && !busyTeacherIds.has(t.id))
    .map((t) => {
      const deptIds = t.departmentIds && t.departmentIds.length ? t.departmentIds : (t.departmentId ? [t.departmentId] : []);
      const deptMatch = targetDept ? deptIds.includes(targetDept) : false;
      const subjMatch = Object.values(inst.timetable || {}).some((entries) =>
        (entries || []).some((e) => e.teacherId === t.id && e.subjectId === sub.subjectId)
      );
      const handledBefore = Object.values(inst.timetable || {}).some((entries) =>
        (entries || []).some((e) => e.teacherId === t.id && e.classId === sub.classId)
      );
      const substitutionsCount = (inst.substitutions || []).filter(
        (s) => s.substituteTeacherId === t.id && s.status === 'Assigned'
      ).length;
      const score = (deptMatch ? 40 : 0) + (subjMatch ? 30 : 0) + (handledBefore ? 20 : 0) - substitutionsCount * 5;
      return {
        teacher: { id: t.id, name: t.name, teacherCode: t.teacherCode, departmentName: nameOf(inst.departments, deptIds[0]) || 'General' },
        deptMatch,
        subjMatch,
        handledBefore,
        substitutionsCount,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function buildStudentData(inst, studentId) {
  const student = (inst.students || []).find((s) => s.id === studentId);
  if (!student) return null;
  const rawClass = (inst.classes || []).find((c) => c.id === student.classId);
  let classInfo = rawClass ? { ...rawClass } : { id: student.classId, name: 'My Class' };
  if (rawClass && rawClass.tutorTeacherId) {
    const t = (inst.teachers || []).find((x) => x.id === rawClass.tutorTeacherId);
    if (t) {
      classInfo.tutorName = t.name;
      classInfo.tutorTeacherName = t.name;
      classInfo.tutorTeacherCode = t.teacherCode;
    }
  }
  const pm = periodMap(inst);

  const relevant = (inst.attendance || []).filter((a) => a.classId === student.classId);
  const logs = [];
  const subjAgg = {};
  let totalConducted = 0;
  let totalAttended = 0;
  relevant.forEach((a) => {
    const rec = (a.records || []).find((r) => r.studentId === studentId);
    if (!rec) return;
    const subjName = nameOf(inst.subjects, a.subjectId) || 'General';
    const teacher = (inst.teachers || []).find((t) => t.id === a.teacherId);
    const p = pm[a.periodId] || {};
    totalConducted += 1;
    if (rec.status === 'present') totalAttended += 1;
    if (!subjAgg[a.subjectId]) subjAgg[a.subjectId] = { subjectId: a.subjectId, subjectName: subjName, conducted: 0, attended: 0 };
    subjAgg[a.subjectId].conducted += 1;
    if (rec.status === 'present') subjAgg[a.subjectId].attended += 1;
    logs.push({ date: a.date, periodLabel: p.label || a.periodId, subjectName: subjName, teacherName: teacher ? teacher.name : 'Faculty', status: rec.status });
  });
  const subjectBreakdown = Object.values(subjAgg).map((s) => ({ ...s, percentage: s.conducted ? Math.round((s.attended / s.conducted) * 100) : 0 }));

  const assignments = (inst.assignments || [])
    .filter((a) => a.classId === student.classId)
    .map((a) => {
      const teacher = (inst.teachers || []).find((t) => t.id === a.teacherId);
      const mySub = (a.submissions || []).find((s) => s.studentId === studentId);
      let status = 'Not Submitted';
      if (mySub) status = mySub.confirmed ? 'Submitted \u2713' : 'Submitted';
      return {
        id: a.id,
        title: a.title,
        description: a.description,
        dueDate: a.dueDate,
        subjectName: nameOf(inst.subjects, a.subjectId) || 'General',
        teacherName: teacher ? teacher.name : 'Faculty',
        status,
        userSubmission: mySub ? { submissionText: mySub.submissionText, submittedAt: mySub.submittedAt } : null,
      };
    });

  return {
    success: true,
    student: { id: student.id, name: student.name, registerNumber: student.registerNumber, year: student.year, classId: student.classId },
    institution: { id: inst.id, name: inst.institution_name || inst.name, institution_name: inst.institution_name, institution_code: inst.institution_code },
    classInfo,
    attendance: {
      totalConducted,
      totalAttended,
      percentage: totalConducted ? Math.round((totalAttended / totalConducted) * 100) : 0,
      subjectBreakdown,
      logs: logs.reverse(),
    },
    assignments,
  };
}

/* =========================================================================
   API ROUTER
   ========================================================================= */
async function apiRouter(req, res) {
  const method = req.method;
  const segs = req.path.split('/').filter(Boolean);
  if (segs[0] === 'api') segs.shift(); // strip the /api mount prefix
  const q = req.query;
  const body = req.body || {};
  const [g0, g1, g2, g3] = segs;

  const json = (data, status = 200) => res.status(status).json(data);
  const err = (message, status = 400) => res.status(status).json({ success: false, error: message });
  const getAuth = () => {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : null;
    return t ? verifyToken(t) : null;
  };

  if (!g0) return json({ message: 'Teacher Period Assistant API', status: 'ok' });

  /* ================= AUTH ================= */
  if (g0 === 'auth') {
    if (g1 === 'institutions' && method === 'GET') {
      const col = await institutions();
      const list = await col.find({}, { projection: { _id: 0, adminPasswordHash: 0 } }).toArray();
      return json({
        institutions: list.map((i) => ({
          id: i.id,
          institution_code: i.institution_code,
          institution_name: i.institution_name,
          name: i.institution_name || i.name,
          claimed: i.claimed,
          adminUsername: i.adminUsername,
        })),
      });
    }

    if (g1 === 'create-institution-admin' && method === 'POST') {
      const { institution_code, username, password, confirmPassword } = body;
      if (!institution_code || !username || !password) return err('Institution code, username and password are required.');
      if (password.length < 8) return err('Password must be at least 8 characters long.');
      if (confirmPassword !== undefined && password !== confirmPassword) return err('Passwords do not match.');
      const code = String(institution_code).trim();
      let inst = await findByCode(code);
      if (inst && inst.claimed && inst.adminPasswordHash) return err('This Institution Code is already registered. Please log in instead.');
      if (!inst) inst = newInstitution(code, username.trim(), hashPassword(password));
      else {
        inst.claimed = true;
        inst.adminUsername = username.trim();
        inst.adminPasswordHash = hashPassword(password);
      }
      await saveInst(inst);
      const token = signToken({ institutionId: inst.id, role: 'admin', uid: inst.id, username: inst.adminUsername });
      return json({ success: true, token, admin: { username: inst.adminUsername }, institution: sanitize(inst) });
    }

    if (g1 === 'login' && method === 'POST') {
      const { institutionCode, username, password } = body;
      const inst = await findByCode(institutionCode);
      if (!inst || !inst.claimed) return err('Invalid Institution Code, Username, or Password.', 401);
      if ((inst.adminUsername || '').toLowerCase() !== String(username || '').trim().toLowerCase() || !verifyPassword(password, inst.adminPasswordHash))
        return err('Invalid Institution Code, Username, or Password.', 401);
      const token = signToken({ institutionId: inst.id, role: 'admin', uid: inst.id, username: inst.adminUsername });
      return json({ success: true, token, institutionId: inst.id, admin: { username: inst.adminUsername } });
    }

    if (g1 === 'teacher-login' && method === 'POST') {
      const { institutionCode, teacherCode } = body;
      const inst = await findByCode(institutionCode);
      if (!inst) return err('Invalid Teacher Code or Institution Code.', 401);
      const teacher = (inst.teachers || []).find((t) => t.teacherCode === String(teacherCode || '').trim());
      if (!teacher) return err('Invalid Teacher Code or Institution Code.', 401);
      const token = signToken({ institutionId: inst.id, role: 'teacher', uid: teacher.id, username: teacher.name });
      return json({
        success: true,
        token,
        institutionId: inst.id,
        institutionName: inst.institution_name || inst.name,
        teacher: { id: teacher.id, name: teacher.name, teacherCode: teacher.teacherCode, phone: teacher.phone || '' },
      });
    }

    if (g1 === 'student-login' && method === 'POST') {
      const { institutionCode, registerNumber } = body;
      const inst = await findByCode(institutionCode);
      if (!inst) return err('Student not found. Please check Register Number.', 401);
      const student = (inst.students || []).find((s) => (s.registerNumber || '').toLowerCase() === String(registerNumber || '').trim().toLowerCase());
      if (!student) return err('Student not found. Please check Register Number.', 401);
      const token = signToken({ institutionId: inst.id, role: 'student', uid: student.id, username: student.name });
      return json({
        success: true,
        token,
        institution: { id: inst.id, name: inst.institution_name || inst.name },
        student: { id: student.id, name: student.name, registerNumber: student.registerNumber },
      });
    }

    if (g1 === 'forgot-password' && method === 'POST') {
      return json({ success: true, resetUrl: `${BASE_URL}/reset-password.html?token=reset_${Date.now()}` });
    }

    if (g1 === 'biometric' && g2 === 'enable' && method === 'POST') {
      const auth = getAuth();
      if (!auth) return err('Unauthorized', 401);
      if (!body.credentialId) return err('credentialId required');
      const col = await credentials();
      await col.replaceOne(
        { credentialId: body.credentialId },
        { credentialId: body.credentialId, institutionId: auth.institutionId, role: auth.role, uid: auth.uid, username: auth.username, label: body.label || '', createdAt: new Date().toISOString() },
        { upsert: true }
      );
      return json({ success: true });
    }

    if (g1 === 'biometric' && g2 === 'login' && method === 'POST') {
      if (!body.credentialId) return err('credentialId required', 400);
      const col = await credentials();
      const cred = await col.findOne({ credentialId: body.credentialId });
      if (!cred) return err('No biometric credential is registered on this device.', 401);
      const inst = await findById(cred.institutionId);
      if (!inst) return err('Institution not found', 404);
      const token = signToken({ institutionId: cred.institutionId, role: cred.role, uid: cred.uid, username: cred.username });
      const out = { success: true, token, role: cred.role, institutionId: cred.institutionId, username: cred.username };
      if (cred.role === 'teacher') {
        const t = (inst.teachers || []).find((x) => x.id === cred.uid);
        out.teacher = t ? { id: t.id, name: t.name, teacherCode: t.teacherCode, phone: t.phone || '' } : { id: cred.uid, name: cred.username, teacherCode: '', phone: '' };
        out.institutionName = inst.institution_name || inst.name;
      } else if (cred.role === 'student') {
        const s = (inst.students || []).find((x) => x.id === cred.uid);
        out.student = s ? { id: s.id, name: s.name, registerNumber: s.registerNumber } : { id: cred.uid, name: cred.username, registerNumber: '' };
        out.institution = { id: inst.id, name: inst.institution_name || inst.name };
      }
      return json(out);
    }

    if (g1 === 'teacher' && g2 === 'timetable' && method === 'GET') {
      const auth = getAuth();
      if (!auth || auth.role !== 'teacher') return err('Unauthorized', 401);
      const inst = await findById(auth.institutionId);
      if (!inst) return err('Institution not found', 404);
      const view = buildTeacherView(inst, auth.uid);
      if (!view) return err('Teacher not found', 404);
      return json({ success: true, ...view });
    }

    if (g1 === 'teacher' && g2 === 'announcements' && method === 'GET') {
      const auth = getAuth();
      if (!auth || auth.role !== 'teacher') return err('Unauthorized', 401);
      const inst = await findById(auth.institutionId);
      if (!inst) return err('Institution not found', 404);
      const teacher = (inst.teachers || []).find((t) => t.id === auth.uid);
      const deptIds = teacher ? (teacher.departmentIds && teacher.departmentIds.length ? teacher.departmentIds : (teacher.departmentId ? [teacher.departmentId] : [])) : [];
      const anns = (inst.announcements || []).filter((a) => {
        const targets = a.targetDepartments || a.departmentIds || [];
        if (!targets.length) return true;
        return targets.some((d) => deptIds.includes(d));
      });
      return json({
        success: true,
        announcements: anns.map((a) => ({ ...a, departmentNames: (a.targetDepartments || a.departmentIds || []).map((d) => nameOf(inst.departments, d)) })),
        departments: (inst.departments || []).filter((d) => deptIds.includes(d.id)),
      });
    }
  }

  /* ================= ADMIN ================= */
  if (g0 === 'admin') {
    const auth = getAuth();
    if (!auth || auth.role !== 'admin') return err('Unauthorized', 401);
    const inst = await findById(auth.institutionId);
    if (!inst) return err('Institution not found', 404);

    if (g1 === 'institution' && !g2 && method === 'GET') return json({ success: true, institution: sanitize(inst) });

    if (g1 === 'institution-name' && method === 'PUT') {
      inst.institution_name = String(body.name || '').trim();
      inst.name = inst.institution_name;
      await saveInst(inst);
      return json({ success: true, institutionName: inst.institution_name });
    }

    if (g1 === 'institution' && g2 === 'settings' && method === 'POST') {
      inst.settings = { ...DEFAULT_SETTINGS, ...(inst.settings || {}), ...body };
      await saveInst(inst);
      return json({ success: true, settings: inst.settings });
    }

    if (g1 === 'periods' && method === 'POST') {
      inst.periods = Array.isArray(body.periods) ? body.periods : [];
      await saveInst(inst);
      return json({ success: true, periods: inst.periods });
    }

    if (g1 === 'timetable' && method === 'POST') {
      inst.timetable = body.timetable && typeof body.timetable === 'object' ? body.timetable : {};
      await saveInst(inst);
      return json({ success: true });
    }

    if (g1 === 'departments') {
      if (method === 'POST') {
        if (!body.name || !body.name.trim()) return err('Department name required.');
        const dept = { id: randomUUID(), name: body.name.trim() };
        inst.departments = [...(inst.departments || []), dept];
        await saveInst(inst);
        return json({ success: true, department: dept });
      }
      if (method === 'DELETE' && g2) {
        inst.departments = (inst.departments || []).filter((d) => d.id !== g2);
        await saveInst(inst);
        return json({ success: true });
      }
    }

    if (g1 === 'classes') {
      if (method === 'POST' && !g3) {
        if (!body.name || !body.name.trim()) return err('Class name required.');
        const cls = { id: randomUUID(), name: body.name.trim(), departmentId: body.departmentId || '', tutorTeacherId: null };
        inst.classes = [...(inst.classes || []), cls];
        await saveInst(inst);
        return json({ success: true, class: cls });
      }
      if (method === 'DELETE' && g2) {
        inst.classes = (inst.classes || []).filter((c) => c.id !== g2);
        await saveInst(inst);
        return json({ success: true });
      }
      if (method === 'POST' && g3 === 'tutor') {
        const teacher = (inst.teachers || []).find((t) => t.teacherCode === String(body.teacherCode || '').trim());
        if (!teacher) return err('No teacher found with that Teacher Code.');
        inst.classes = (inst.classes || []).map((c) => (c.id === g2 ? { ...c, tutorTeacherId: teacher.id } : c));
        await saveInst(inst);
        return json({ success: true, tutorTeacherId: teacher.id, tutorName: teacher.name });
      }
    }

    if (g1 === 'subjects') {
      if (method === 'POST') {
        if (!body.name || !body.name.trim()) return err('Subject name required.');
        const subj = { id: randomUUID(), name: body.name.trim(), departmentId: body.departmentId || '', classId: body.classId || '' };
        inst.subjects = [...(inst.subjects || []), subj];
        await saveInst(inst);
        return json({ success: true, subject: subj });
      }
      if (method === 'DELETE' && g2) {
        inst.subjects = (inst.subjects || []).filter((s) => s.id !== g2);
        await saveInst(inst);
        return json({ success: true });
      }
    }

    if (g1 === 'teachers') {
      if (method === 'POST' && !g3) {
        if (!body.name || !body.name.trim()) return err('Teacher name required.');
        const teacher = {
          id: randomUUID(),
          name: body.name.trim(),
          phone: body.phone || '',
          teacherCode: genTeacherCode(inst),
          departmentIds: body.departmentIds || (body.departmentId ? [body.departmentId] : []),
          departmentId: body.departmentId || (body.departmentIds && body.departmentIds[0]) || '',
          devices: [],
        };
        inst.teachers = [...(inst.teachers || []), teacher];
        await saveInst(inst);
        return json({ success: true, teacher });
      }
      if (method === 'PUT' && g2) {
        inst.teachers = (inst.teachers || []).map((t) =>
          t.id === g2
            ? {
                ...t,
                name: body.name ? body.name.trim() : t.name,
                phone: body.phone !== undefined ? body.phone : t.phone,
                departmentIds: body.departmentIds || t.departmentIds || [],
                departmentId: body.departmentId || (body.departmentIds && body.departmentIds[0]) || t.departmentId || '',
              }
            : t
        );
        await saveInst(inst);
        return json({ success: true, teacher: (inst.teachers || []).find((t) => t.id === g2) });
      }
      if (method === 'DELETE' && g2) {
        inst.teachers = (inst.teachers || []).filter((t) => t.id !== g2);
        await saveInst(inst);
        return json({ success: true });
      }
      if (method === 'POST' && g3 === 'registration-link') {
        const teacher = (inst.teachers || []).find((t) => t.id === g2);
        const registrationUrl = `${BASE_URL}/register-device.html?token=${signToken({ institutionId: inst.id, role: 'teacher', uid: g2, username: teacher ? teacher.name : '' })}&code=${teacher ? teacher.teacherCode : ''}`;
        return json({ success: true, registrationUrl });
      }
    }

    if (g1 === 'devices' && method === 'DELETE' && g2) {
      inst.teachers = (inst.teachers || []).map((t) => ({ ...t, devices: (t.devices || []).filter((d) => d.id !== g2) }));
      await saveInst(inst);
      return json({ success: true });
    }

    if (g1 === 'announcements') {
      if (method === 'POST') {
        const ann = {
          id: randomUUID(),
          title: (body.title || '').trim(),
          message: (body.message || '').trim(),
          targetDepartments: body.targetDepartments || body.departmentIds || [],
          departmentIds: body.departmentIds || body.targetDepartments || [],
          createdAt: new Date().toISOString(),
        };
        inst.announcements = [ann, ...(inst.announcements || [])];
        await saveInst(inst);
        return json({ success: true, announcement: ann });
      }
      if (method === 'PUT' && g2) {
        inst.announcements = (inst.announcements || []).map((a) =>
          a.id === g2
            ? { ...a, title: (body.title || '').trim(), message: (body.message || '').trim(), targetDepartments: body.targetDepartments || body.departmentIds || [], departmentIds: body.departmentIds || body.targetDepartments || [] }
            : a
        );
        await saveInst(inst);
        return json({ success: true, announcement: (inst.announcements || []).find((a) => a.id === g2) });
      }
      if (method === 'DELETE' && g2) {
        inst.announcements = (inst.announcements || []).filter((a) => a.id !== g2);
        await saveInst(inst);
        return json({ success: true });
      }
    }

    if (g1 === 'leaves') {
      if (method === 'GET' && !g2) return json({ success: true, leaves: (inst.leaves || []).slice().reverse() });
      if (method === 'PUT' && g2 && g3 === 'approve') {
        const leave = (inst.leaves || []).find((l) => l.id === g2);
        if (!leave) return err('Leave not found.', 404);
        leave.status = 'Approved';
        generateSubstitutions(inst, leave);
        await saveInst(inst);
        return json({ success: true });
      }
      if (method === 'PUT' && g2 && g3 === 'reject') {
        const leave = (inst.leaves || []).find((l) => l.id === g2);
        if (!leave) return err('Leave not found.', 404);
        leave.status = 'Rejected';
        await saveInst(inst);
        return json({ success: true });
      }
    }

    if (g1 === 'substitutions') {
      if (method === 'GET' && !g2) {
        const status = q.status || 'Pending';
        let subs = inst.substitutions || [];
        if (status === 'Pending') subs = subs.filter((s) => s.status === 'Pending');
        else if (status === 'Assigned') subs = subs.filter((s) => s.status === 'Assigned');
        else subs = subs.filter((s) => s.status === 'Cancelled' || s.status === 'Completed');
        return json({ success: true, substitutions: subs.slice().reverse() });
      }
      if (method === 'GET' && g2 && g3 === 'candidates') {
        const sub = (inst.substitutions || []).find((s) => s.id === g2);
        if (!sub) return err('Substitution not found.', 404);
        return json({ success: true, candidates: rankCandidates(inst, sub) });
      }
      if (method === 'POST' && g2 && g3 === 'assign') {
        const sub = (inst.substitutions || []).find((s) => s.id === g2);
        if (!sub) return err('Substitution not found.', 404);
        const teacher = (inst.teachers || []).find((t) => t.id === body.substituteTeacherId);
        if (!teacher) return err('Substitute teacher not found.');
        sub.status = 'Assigned';
        sub.substituteTeacherId = teacher.id;
        sub.substituteTeacherName = teacher.name;
        await saveInst(inst);
        return json({ success: true, substitution: sub });
      }
      if (method === 'PUT' && g2 && g3 === 'cancel') {
        const sub = (inst.substitutions || []).find((s) => s.id === g2);
        if (!sub) return err('Substitution not found.', 404);
        sub.status = 'Cancelled';
        sub.substituteTeacherId = null;
        sub.substituteTeacherName = null;
        await saveInst(inst);
        return json({ success: true });
      }
    }
  }

  /* ================= TEACHER ================= */
  if (g0 === 'teacher') {
    const auth = getAuth();
    if (!auth || auth.role !== 'teacher') return err('Unauthorized', 401);
    const inst = await findById(auth.institutionId);
    if (!inst) return err('Institution not found', 404);
    const meId = auth.uid;

    if (g1 === 'classes' && method === 'GET') {
      const taughtClassIds = new Set();
      const taughtSubjectIds = new Set();
      Object.values(inst.timetable || {}).forEach((entries) =>
        (entries || []).forEach((e) => {
          if (e.teacherId === meId) {
            taughtClassIds.add(e.classId);
            taughtSubjectIds.add(e.subjectId);
          }
        })
      );
      (inst.classes || []).forEach((c) => { if (c.tutorTeacherId === meId) taughtClassIds.add(c.id); });
      let classes = (inst.classes || []).filter((c) => taughtClassIds.has(c.id));
      if (!classes.length) classes = inst.classes || [];
      let subjects = (inst.subjects || []).filter((s) => taughtSubjectIds.has(s.id));
      if (!subjects.length) subjects = inst.subjects || [];
      return json({ success: true, classes, subjects });
    }

    if (g1 === 'tutor-classes' && method === 'GET') {
      const classes = (inst.classes || [])
        .filter((c) => c.tutorTeacherId === meId)
        .map((c) => {
          const t = (inst.teachers || []).find((x) => x.id === c.tutorTeacherId);
          return { ...c, tutorTeacherName: t ? t.name : null, tutorTeacherCode: t ? t.teacherCode : null };
        });
      return json({ success: true, classes });
    }

    if (g1 === 'students') {
      if (method === 'GET') {
        const classId = q.classId;
        const students = (inst.students || []).filter((s) => !classId || s.classId === classId);
        return json({ success: true, students });
      }
      if (method === 'POST' && !g2) {
        if (!body.name || !body.registerNumber) return err('Name and register number required.');
        const dup = (inst.students || []).find((s) => (s.registerNumber || '').toLowerCase() === body.registerNumber.trim().toLowerCase());
        if (dup) return err('A student with this Register Number already exists.');
        const student = { id: randomUUID(), name: body.name.trim(), registerNumber: body.registerNumber.trim(), classId: body.classId || '', year: body.year || '1st Year' };
        inst.students = [...(inst.students || []), student];
        await saveInst(inst);
        return json({ success: true, student });
      }
      if (method === 'PUT' && g2) {
        inst.students = (inst.students || []).map((s) =>
          s.id === g2 ? { ...s, name: body.name ? body.name.trim() : s.name, registerNumber: body.registerNumber ? body.registerNumber.trim() : s.registerNumber, classId: body.classId || s.classId, year: body.year || s.year } : s
        );
        await saveInst(inst);
        return json({ success: true, student: (inst.students || []).find((s) => s.id === g2) });
      }
      if (method === 'DELETE' && g2) {
        inst.students = (inst.students || []).filter((s) => s.id !== g2);
        await saveInst(inst);
        return json({ success: true });
      }
    }

    if (g1 === 'attendance') {
      if (method === 'GET') {
        const { classId, date, periodId } = q;
        const rec = (inst.attendance || []).find((a) => a.classId === classId && a.date === date && a.periodId === periodId);
        return json({ success: true, records: rec ? rec.records : [], subjectId: rec ? rec.subjectId : null });
      }
      if (method === 'POST') {
        const { classId, subjectId, date, periodId, records } = body;
        if (!classId || !date || !periodId) return err('classId, date and periodId required.');
        const idx = (inst.attendance || []).findIndex((a) => a.classId === classId && a.date === date && a.periodId === periodId);
        const entry = { id: idx >= 0 ? inst.attendance[idx].id : randomUUID(), classId, subjectId: subjectId || 's_gen', date, periodId, teacherId: meId, records: records || [], updatedAt: new Date().toISOString() };
        if (idx >= 0) inst.attendance[idx] = entry;
        else inst.attendance = [...(inst.attendance || []), entry];
        await saveInst(inst);
        return json({ success: true });
      }
    }

    if (g1 === 'assignments') {
      if (method === 'GET') {
        const mine = (inst.assignments || [])
          .filter((a) => a.teacherId === meId)
          .map((a) => ({
            ...a,
            className: nameOf(inst.classes, a.classId),
            subjectName: nameOf(inst.subjects, a.subjectId) || 'General',
            submissions: (a.submissions || []).map((s) => {
              const st = (inst.students || []).find((x) => x.id === s.studentId) || {};
              return { studentId: s.studentId, studentName: st.name || 'Student', registerNumber: st.registerNumber || '', submissionText: s.submissionText, status: s.confirmed ? 'Submitted \u2713' : 'Submitted' };
            }),
          }));
        return json({ success: true, assignments: mine.reverse() });
      }
      if (method === 'POST') {
        if (!body.title || !body.classId) return err('Title and class required.');
        const asgn = { id: randomUUID(), classId: body.classId, subjectId: body.subjectId || 's_gen', teacherId: meId, title: body.title.trim(), description: (body.description || '').trim(), dueDate: body.dueDate || '', createdAt: new Date().toISOString(), submissions: [] };
        inst.assignments = [...(inst.assignments || []), asgn];
        await saveInst(inst);
        return json({ success: true, assignment: asgn });
      }
    }

    if (g1 === 'confirm-assignment' && method === 'POST') {
      const asgn = (inst.assignments || []).find((a) => a.id === body.assignmentId);
      if (!asgn) return err('Assignment not found.', 404);
      let sub = (asgn.submissions || []).find((s) => s.studentId === body.studentId);
      if (!sub) {
        sub = { studentId: body.studentId, submissionText: '(marked submitted by faculty)', submittedAt: new Date().toISOString(), confirmed: true };
        asgn.submissions = [...(asgn.submissions || []), sub];
      } else {
        sub.confirmed = true;
      }
      await saveInst(inst);
      return json({ success: true });
    }

    if (g1 === 'leaves') {
      if (method === 'GET') return json({ success: true, leaves: (inst.leaves || []).filter((l) => l.teacherId === meId).slice().reverse() });
      if (method === 'POST') {
        const teacher = (inst.teachers || []).find((t) => t.id === meId);
        const leave = { id: randomUUID(), teacherId: meId, teacherName: teacher ? teacher.name : auth.username, fromDate: body.fromDate, toDate: body.toDate, type: body.type || 'full_day', periodId: body.periodId || null, reason: (body.reason || '').trim(), status: 'Pending', createdAt: new Date().toISOString() };
        inst.leaves = [...(inst.leaves || []), leave];
        await saveInst(inst);
        return json({ success: true, leave });
      }
      if (method === 'DELETE' && g2) {
        const leave = (inst.leaves || []).find((l) => l.id === g2);
        if (!leave || leave.teacherId !== meId) return err('Leave not found.', 404);
        inst.leaves = (inst.leaves || []).filter((l) => l.id !== g2);
        await saveInst(inst);
        return json({ success: true });
      }
    }

    if (g1 === 'substitutions' && method === 'GET') {
      const todayStr = new Date().toISOString().slice(0, 10);
      const mine = (inst.substitutions || []).filter((s) => s.substituteTeacherId === meId);
      const enrich = (s) => ({ ...s, roomName: s.roomName || '' });
      return json({
        success: true,
        today: mine.filter((s) => s.date === todayStr).map(enrich),
        upcoming: mine.filter((s) => s.date > todayStr).map(enrich),
        history: mine.filter((s) => s.date < todayStr).map(enrich),
      });
    }
  }

  /* ================= STUDENT ================= */
  if (g0 === 'student') {
    const auth = getAuth();
    if (!auth || auth.role !== 'student') return err('Unauthorized', 401);
    const inst = await findById(auth.institutionId);
    if (!inst) return err('Institution not found', 404);

    if (g1 === 'my-data' && method === 'GET') {
      const data = buildStudentData(inst, auth.uid);
      if (!data) return err('Student profile not found.', 404);
      return json(data);
    }

    if (g1 === 'submit-assignment' && method === 'POST') {
      const asgn = (inst.assignments || []).find((a) => a.id === body.assignmentId);
      if (!asgn) return err('Assignment not found.', 404);
      let sub = (asgn.submissions || []).find((s) => s.studentId === auth.uid);
      if (sub) {
        sub.submissionText = body.submissionText;
        sub.submittedAt = new Date().toISOString();
      } else {
        asgn.submissions = [...(asgn.submissions || []), { studentId: auth.uid, submissionText: body.submissionText, submittedAt: new Date().toISOString(), confirmed: false }];
      }
      await saveInst(inst);
      return json({ success: true });
    }
  }

  /* ================= PUSH / DEVICES ================= */
  if (g0 === 'push') {
    if (g1 === 'code-info' && method === 'GET') {
      const code = q.code;
      const col = await institutions();
      const inst = await col.findOne({ 'teachers.teacherCode': String(code || '').trim() });
      if (!inst) return err('Invalid Teacher Code. Please verify with Administrator.', 404);
      const teacher = (inst.teachers || []).find((t) => t.teacherCode === String(code).trim());
      return json({ success: true, teacherName: teacher.name, teacherCode: teacher.teacherCode, institutionName: inst.institution_name || inst.name, phone: teacher.phone || '' });
    }

    if (g1 === 'register-code-device' && method === 'POST') {
      const { teacherCode, subscription, deviceName } = body;
      const col = await institutions();
      const inst = await col.findOne({ 'teachers.teacherCode': String(teacherCode || '').trim() });
      if (!inst) return err('Invalid Teacher Code.', 404);
      inst.teachers = (inst.teachers || []).map((t) =>
        t.teacherCode === String(teacherCode).trim()
          ? { ...t, devices: [...(t.devices || []), { id: randomUUID(), deviceName: deviceName || 'Mobile', subscription, registeredAt: new Date().toISOString() }] }
          : t
      );
      await saveInst(inst);
      return json({ success: true });
    }

    if (g1 === 'test-notification' && method === 'POST') {
      const auth = getAuth();
      if (!auth) return err('Unauthorized', 401);
      const inst = await findById(auth.institutionId);
      const teacher = (inst.teachers || []).find((t) => t.id === body.teacherId);
      if (!teacher || !(teacher.devices || []).length) return err('No registered devices found for teacher.');
      return json({ success: true, message: `Test notification dispatched to ${teacher.devices.length} device(s) for ${teacher.name}.` });
    }
  }

  return err('Not found', 404);
}

/* =========================================================================
   SERVER
   ========================================================================= */
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// API routes
app.all('/api', (req, res, next) => apiRouter(req, res).catch(next));
app.all('/api/*', (req, res, next) => apiRouter(req, res).catch(next));

// Serve the frontend (single page) from ../frontend
const FRONTEND_DIR = fs.existsSync(path.join(__dirname, '..', 'frontend'))
  ? path.join(__dirname, '..', 'frontend')
  : path.resolve(process.cwd(), 'frontend');

app.use(express.static(FRONTEND_DIR, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    }
  }
}));

// SPA fallback route for page navigation (excluding API routes and static asset requests)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  // Prevent serving index.html (text/html) for missing JS/CSS/asset requests which causes MIME type errors
  if (/\.(js|mjs|css|json|png|jpg|jpeg|gif|ico|svg|map|woff2?|ttf|eot)$/i.test(req.path)) {
    return res.status(404).type('text/plain').send('File not found');
  }
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.sendFile(indexPath);
  } else {
    res.status(404).type('text/plain').send('Index HTML not found');
  }
});

// Error handler
app.use((error, req, res, next) => {
  console.error('[error]', error);
  res.status(500).json({ success: false, error: 'Internal server error: ' + error.message });
});

app.listen(PORT, () => console.log(`[server] Teacher Period Assistant running on http://localhost:${PORT}`));

module.exports = app;
