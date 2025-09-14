/* eslint-disable no-console */
// functions/index.js
const { setGlobalOptions } = require("firebase-functions/v2/options");
const { defineSecret } = require("firebase-functions/params");
const {
  onDocumentCreated,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { create, all } = require("mathjs");

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

admin.initializeApp();
const db = admin.firestore();
const math = create(all, {});

// ---- Secret for OpenAI ----
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// ---- Lazy OpenAI init ----
let _openai = null;
function getOpenAI(apiKey) {
  if (_openai) return _openai;
  const { OpenAI } = require("openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY missing at runtime");
  _openai = new OpenAI({ apiKey });
  return _openai;
}

// ------------------------- Helpers -------------------------
const clamp = (n, lo, hi) => Math.min(Math.max(Number(n || 0), lo), hi);
const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);

// UI stores answers as { [qid]: { value, type } } → pull out the value safely.
const asVal = (answers, qid) => {
  const a = answers?.[qid];
  return a && typeof a === "object" && "value" in a ? a.value : a;
};

const eqSet = (a = [], b = []) => {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
};

// "Clarity:0.4, Accuracy:0.6" → normalized weights that sum to 1
function parseCriteriaString(str = "") {
  const out = [];
  for (const part of String(str).split(",")) {
    const [rawName, rawW] = part.split(":").map((s) => (s || "").trim());
    if (!rawName) continue;
    const w = Number(rawW);
    out.push({ name: rawName, weight: Number.isFinite(w) ? w : 0 });
  }
  const total = out.reduce((t, c) => t + c.weight, 0) || 1;
  return out.map((c) => ({ ...c, weight: c.weight / total }));
}

// ------------------ Deterministic graders ------------------
function gradeMCQ(q, ans) {
  // ans: array of indices; q.correctOptions: array of indices
  const a = Array.isArray(ans) ? ans.map(Number) : [];
  const b = Array.isArray(q.correctOptions) ? q.correctOptions.map(Number) : [];
  return eqSet(a, b) ? Number(q.marks) || 0 : 0;
}

function gradeYesNo(q, ans) {
  return Boolean(ans) === Boolean(q.correctYesNo) ? Number(q.marks) || 0 : 0;
}

function gradeNumeric(q, ans) {
  try {
    const expected = math.evaluate(String(q.solution ?? ""));
    const got = math.evaluate(String(ans ?? ""));
    const tol = Number(q.tolerance ?? 0); // optional tolerance
    return Math.abs(expected - got) <= tol ? Number(q.marks) || 0 : 0;
  } catch (e) {
    console.warn("[gradeNumeric] evaluation failed:", e?.message);
    return 0;
  }
}

// ------------------------ AI grader ------------------------
async function gradeWithAI(input, apiKey) {
  const openai = getOpenAI(apiKey);

  const sys =
    "You are a rigorous grader. Return STRICT JSON ONLY: a map of questionId -> " +
    "{points:number, reason:string, perCriterion:[{name,points,reason}]}.\n" +
    "Never exceed the marks of a question. No prose outside JSON.";

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: JSON.stringify(input) },
    ],
  });

  let content = "{}";
  try {
    content = resp?.choices?.[0]?.message?.content || "{}";
  } catch (e) {
    console.warn("[gradeWithAI] reading OpenAI content failed:", e?.message);
  }
  try {
    return JSON.parse(content);
  } catch (e) {
    console.warn("[gradeWithAI] JSON parse failed:", e?.message, "content:", content);
    return {};
  }
}

// -------------- Shared grading handler (core) --------------
async function handleGrade(event) {
  const snap = event.data;
  if (!snap) return null;

  const { examId } = event.params || {};
  const subRef = snap.ref;
  const docPath = subRef.path;
  const sub = snap.data() || {};
  const answers = sub.answers || {};

  // Best-effort status update
  try {
    await subRef.update({ status: "grading" });
  } catch (e) {
    console.warn("[handleGrade] could not set status=grading:", e?.message);
  }

  // Load exam + questions
  const examSnap = await db.doc(`exams/${examId}`).get();
  const exam = examSnap.exists ? examSnap.data() : {};

  const qSnap = await db
    .collection(`exams/${examId}/questions`)
    .orderBy("index")
    .get();
  const questions = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const scores = {}; // { qid: number }
  const reports = {}; // { qid: { points, reason, perCriterion[] } }

  // 1) Deterministic grading
  for (const q of questions) {
    const qid = q.id;
    const val = asVal(answers, qid);

    if (q.type === "mcq") {
      scores[qid] = gradeMCQ(q, val);
    } else if (q.type === "yesno") {
      scores[qid] = gradeYesNo(q, val);
    } else if (q.type === "math") {
      const pts = gradeNumeric(q, val);
      if (Number.isFinite(pts)) scores[qid] = pts;
    }
    // essay → only AI section
  }

  // 2) AI grading for essay and math (optional assist, hardened with aiMeta)
  let aiMeta = { used: false, model: "gpt-4o-mini", error: null };
  try {
    const aiItems = {};
    const allowEssay = !!exam?.settings?.aiEssay;
    const allowMath = !!exam?.settings?.aiMath;

    for (const q of questions) {
      const allowed =
        (q.type === "essay" && allowEssay) ||
        (q.type === "math" && allowMath);
      if (!allowed) continue;

      const qid = q.id;
      const criteria = parseCriteriaString(q.rubric || "Quality:1");
      aiItems[qid] = {
        type: q.type,
        marks: Number(q.marks) || 0,
        question: q.text || "",
        criteria, // [{name, weight}]
        expected: q.solution || null, // math hint (optional)
        answer: asVal(answers, qid) ?? "",
      };
    }

    if (Object.keys(aiItems).length) {
      aiMeta.used = true;

      const aiRaw = await gradeWithAI(
        {
          examTitle: exam.title || "Exam",
          items: aiItems,
        },
        OPENAI_API_KEY.value()
      );

      // aiRaw: { qid: { points, reason, perCriterion[] } }
      for (const [qid, r] of Object.entries(aiRaw || {})) {
        const max = Number(aiItems[qid]?.marks || 0);
        const pts = clamp(r?.points, 0, max);
        // Keep higher of deterministic vs AI (e.g., exact numeric)
        scores[qid] = Math.max(Number(scores[qid] || 0), Number(pts || 0));
        reports[qid] = {
          points: Number(pts || 0),
          reason: r?.reason || "",
          perCriterion: Array.isArray(r?.perCriterion)
            ? r.perCriterion.map((c) => ({
                name: c?.name || "",
                points: Number(c?.points || 0),
                reason: c?.reason || "",
              }))
            : [],
        };
      }
    }
  } catch (e) {
    console.error("[handleGrade] AI grading failed:", e);
    aiMeta.error = (e?.error?.message || e?.message || "AI request failed") + "";
  }

  const total = sum(Object.values(scores));

  // Student-visible fields on the submission/attempt doc
  await subRef.set(
    {
      status: "graded",
      scores: { ...scores, total },
      gradedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Teacher-only AI details
  await subRef.collection("teacher").doc("ai").set({
    total,
    perQuestion: scores,
    reports, // { [qid]: { points, reason, perCriterion[] } }
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    source: docPath.includes("/attempts/") ? "attempts" : "submissions",
    aiMeta, // <— persist AI usage & error info
  });

  return null;
}

// --------------------------- Triggers ---------------------------

// Preferred: grade when a normalized submission is created
exports.gradeSubmission = onDocumentCreated(
  {
    document: "exams/{examId}/submissions/{subId}",
    secrets: [OPENAI_API_KEY],
  },
  handleGrade
);

// Legacy: grade when an attempt transitions to "submitted"
exports.gradeAttemptOnSubmit = onDocumentWritten(
  {
    document: "exams/{examId}/attempts/{subId}",
    secrets: [OPENAI_API_KEY],
  },
  async (event) => {
    if (!event.data?.after?.exists) return null;
    const before = event.data.before?.data() || {};
    const after = event.data.after?.data() || {};

    const beforeSubmitted = !!before.submittedAt;
    const afterSubmitted = !!after.submittedAt;
    const statusFlip =
      before.status !== "submitted" && after.status === "submitted";

    const justSubmitted = (!beforeSubmitted && afterSubmitted) || statusFlip;
    if (!justSubmitted) return null;

    return handleGrade({ data: event.data.after, params: event.params });
  }
);

// --- EMAIL NOTIFY ON NEW GRADE (uses Firebase Trigger Email extension) ---
exports.emailOnNewGrade = onDocumentCreated(
  // fire when teacher writes to users/{uid}/grades/{gradeId}
  { document: "users/{uid}/grades/{gradeId}" },
  async (event) => {
    const snap = event.data;
    if (!snap) return null;

    const g = snap.data() || {};
    const uid = event.params.uid;

    try {
      // prevent duplicate sends if doc gets re-written later
      if (g.emailSent === true) return null;

      // resolve recipient email
      let to = (g.userEmail || "").trim();
      if (!to) {
        const u = await db.collection("users").doc(uid).get();
        to = (u.exists && (u.data().email || "").trim()) || "";
      }
      if (!to) {
        console.warn("[emailOnNewGrade] no recipient email for uid:", uid);
        return null;
      }

      // resolve course name for a nicer subject
      let courseName = String(g.courseId || "").trim();
      if (courseName) {
        const c = await db.collection("courses").doc(courseName).get();
        if (c.exists) courseName = c.data().name || courseName;
      }

      const assessment = g.assessment || g.assessmentName || "Assessment";
      const gradeValue = String(g.grade ?? "—");
      const when =
        g.gradedAt?.toDate?.()
          ? g.gradedAt.toDate().toLocaleString()
          : new Date().toLocaleString();

      const subject = `New grade posted: ${assessment} · ${courseName || "your course"}`;
      const text = [
        `Hello,`,
        ``,
        `A new grade was posted for ${assessment} in ${courseName || "your course"}.`,
        `Grade: ${gradeValue}`,
        ``,
        `Posted: ${when}`,
      ].join("\n");

      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111827">
          <h2 style="margin:0 0 8px">New grade posted</h2>
          <p style="margin:0 0 8px">
            <strong>Course:</strong> ${courseName || "—"}<br/>
            <strong>Assessment:</strong> ${assessment}<br/>
            <strong>Grade:</strong> ${gradeValue}<br/>
            <strong>Posted:</strong> ${when}
          </p>
          ${g.notes ? `<p style="margin:12px 0 0;white-space:pre-wrap">${String(g.notes)}</p>` : ""}
        </div>
      `;

      // write to /mail -> Trigger Email extension sends it
      await db.collection("mail").add({
        to,
        message: { subject, text, html },
      });

      // flag grade so we don't resend
      await snap.ref.set({ emailSent: true }, { merge: true });
    } catch (err) {
      console.error("[emailOnNewGrade] failed:", err);
    }
    return null;
  }
);
