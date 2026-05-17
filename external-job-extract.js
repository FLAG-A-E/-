const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

function ensureFirebaseAdmin() {
  if (admin.apps.length) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("missing_firebase_admin_env");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey
    })
  });
}

const ADMIN_EMAILS = new Set(["hanterd0@gmail.com"]);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function cleanValue(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    ensureFirebaseAdmin();

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return res.status(401).json({ ok: false, error: "missing_auth_token" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const email = String(decoded.email || "").toLowerCase();
    if (!ADMIN_EMAILS.has(email)) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const rawText = String(req.body?.rawText || "").trim();
    if (!rawText || rawText.length < 15) {
      return res.status(400).json({ ok: false, error: "invalid_raw_text" });
    }

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("missing_gemini_api_key");
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `استخرج بيانات إعلان وظيفة من النص التالي.
أعد النتيجة بصيغة JSON فقط وبدون أي نص إضافي.
المفاتيح المطلوبة فقط:
title, location, category, description, contact

نص الإعلان:
${rawText}`;

    const result = await model.generateContent(prompt);
    const rawOutput = result?.response?.text?.() || "{}";
    const jsonOnly = rawOutput.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(jsonOnly);

    const job = {
      title: cleanValue(parsed.title, "بدون عنوان"),
      location: cleanValue(parsed.location, "غير محدد"),
      category: cleanValue(parsed.category, "غير محدد"),
      description: cleanValue(parsed.description, "لا يوجد وصف مضاف حالياً."),
      contact: cleanValue(parsed.contact, "غير متوفر")
    };

    return res.status(200).json({ ok: true, job });
  } catch (error) {
    console.error("external-job-extract error", error);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};
