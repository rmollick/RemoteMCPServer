import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

import { toolDecl, toolImpl } from "./tools/toolRegistry.js";

const PORT = Number(process.env.PORT || 3333);

const app = express();
app.use(express.json({ limit: "12mb" })); // allow image base64 payloads
app.use(express.static("public"));

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Validate API key ---
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("❌ GEMINI_API_KEY missing. Put it in daemon/.env as GEMINI_API_KEY=...");
  process.exit(1);
}

// --- Gemini Client ---
const ai = new GoogleGenAI({ apiKey });

// --- Load persistent workspace memory ---
const WORKSPACE_MEMORY_PATH = path.join(__dirname, "prompts", "workspace_memory.txt");
if (!fs.existsSync(WORKSPACE_MEMORY_PATH)) {
  console.error(`❌ Missing workspace memory file at: ${WORKSPACE_MEMORY_PATH}`);
  console.error("Create it at: daemon/src/prompts/workspace_memory.txt");
  process.exit(1);
}
const WORKSPACE_MEMORY = fs.readFileSync(WORKSPACE_MEMORY_PATH, "utf-8");

// --- Workspace root for the UI file browser ---
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT
  ? path.resolve(process.env.WORKSPACE_ROOT)
  : process.cwd();

// Normalize once (important on Windows)
const WORKSPACE_ROOT_REAL = fs.existsSync(WORKSPACE_ROOT)
  ? fs.realpathSync.native(WORKSPACE_ROOT)
  : WORKSPACE_ROOT;

function toPosix(p) {
  return String(p || "").replaceAll("\\", "/");
}

function safeJoin(relPath) {
  const rel = String(relPath || "").replaceAll("\\", "/");

  // Block absolute paths (Windows + POSIX) and UNC paths
  // Examples blocked:
  //   C:\foo
  //   \\server\share
  //   /etc/passwd
  if (/^[a-zA-Z]:[\\/]/.test(rel)) throw new Error("Absolute paths are not allowed");
  if (/^\\\\/.test(String(relPath || ""))) throw new Error("UNC paths are not allowed");
  if (rel.startsWith("/")) throw new Error("Absolute paths are not allowed");

  const abs = path.resolve(WORKSPACE_ROOT_REAL, rel);
  const absReal = fs.existsSync(abs) ? fs.realpathSync.native(abs) : abs;

  // Ensure proper boundary check (avoid C:\root2 matching C:\root)
  const rootWithSep = WORKSPACE_ROOT_REAL.endsWith(path.sep)
    ? WORKSPACE_ROOT_REAL
    : WORKSPACE_ROOT_REAL + path.sep;

  if (absReal !== WORKSPACE_ROOT_REAL && !absReal.startsWith(rootWithSep)) {
    throw new Error("Path escapes workspace root");
  }

  return absReal;
}

// --- Web server + WS server ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(obj) {
  const msg = typeof obj === "string" ? obj : JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", root: WORKSPACE_ROOT_REAL }));
});

// -----------------------------
// API: workspace browser
// -----------------------------
app.get("/api/root", (req, res) => {
  res.json({ ok: true, root: WORKSPACE_ROOT_REAL, platform: os.platform() });
});

app.get("/api/list", (req, res) => {
  try {
    const rel = req.query.path ? String(req.query.path) : "";
    const abs = safeJoin(rel);

    const entries = fs
      .readdirSync(abs, { withFileTypes: true })
      .map((d) => ({
        name: d.name,
        type: d.isDirectory() ? "dir" : "file",
        path: toPosix(path.join(rel, d.name)),
      }))
      .slice(0, 800);

    res.json({ ok: true, entries, path: toPosix(rel) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/api/read", (req, res) => {
  try {
    const rel = String(req.query.path || "");
    const abs = safeJoin(rel);

    const content = fs.readFileSync(abs, "utf-8");
    res.json({ ok: true, path: toPosix(rel), content });
  } catch (e) {
    res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// -----------------------------
// Helper: extract function calls robustly
// -----------------------------
function getFunctionCalls(response) {
  if (Array.isArray(response?.functionCalls)) return response.functionCalls;

  const parts = response?.candidates?.[0]?.content?.parts || [];
  const calls = [];
  for (const p of parts) {
    if (p?.functionCall) calls.push(p.functionCall);
  }
  return calls;
}

function getText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const texts = [];
  for (const p of parts) {
    if (typeof p?.text === "string" && p.text.trim()) texts.push(p.text);
  }
  return texts.join("\n").trim();
}

// -----------------------------
// Agent core: multimodal + tools loop
// -----------------------------
async function runAgentOnce({ prompt, selectedPath, image }) {
  if (image?.dataBase64 && image.dataBase64.length > 6_000_000) {
    return { ok: false, error: "Image too large (base64 > ~6MB). Use smaller image." };
  }

  // Keep selectedPath as context only (do NOT trust it as a filesystem path here)
  // Your tools should enforce WORKSPACE_ROOT sandboxing.
  const augmentedPrompt =
    (image?.dataBase64 ? "[INPUT_INCLUDES_IMAGE]\n" : "") +
    (selectedPath ? `[UI_SELECTED_PATH]\n${selectedPath}\n\n` : "") +
    prompt;

  const userParts = [{ text: augmentedPrompt }];

  if (image?.dataBase64) {
    userParts.push({
      inlineData: {
        mimeType: image.mimeType || "image/png",
        data: image.dataBase64,
      },
    });
  }

  broadcast({ type: "agent_start" });

  const history = [{ role: "user", parts: userParts }];

  let response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: history,
    config: {
      systemInstruction: WORKSPACE_MEMORY,
      tools: [{ functionDeclarations: toolDecl }],
    },
  });

  const maxSteps = 12;
  let steps = 0;

  while (steps < maxSteps) {
    steps++;

    const calls = getFunctionCalls(response);
    if (calls.length) {
      broadcast({ type: "tool_calls", steps, count: calls.length, calls });

      history.push({ role: "model", parts: calls.map((c) => ({ functionCall: c })) });

      const toolResponseParts = [];
      for (const call of calls) {
        const name = call.name;
        const args = call.args || {};

        const fn = toolImpl[name];
        if (!fn) {
          const err = { ok: false, error: `Unknown tool: ${name}` };
          toolResponseParts.push({ functionResponse: { name, response: err } });
          broadcast({ type: "tool_result", name, ok: false, error: err.error });
          continue;
        }

        broadcast({ type: "tool_call", name, args });

        try {
          const result = await fn(args);
          toolResponseParts.push({ functionResponse: { name, response: result } });
          broadcast({ type: "tool_result", name, ok: true });
        } catch (e) {
          const err = { ok: false, error: e?.message || String(e) };
          toolResponseParts.push({ functionResponse: { name, response: err } });
          broadcast({ type: "tool_result", name, ok: false, error: err.error });
        }
      }

      history.push({ role: "user", parts: toolResponseParts });

      response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: history,
        config: {
          systemInstruction: WORKSPACE_MEMORY,
          tools: [{ functionDeclarations: toolDecl }],
        },
      });

      continue;
    }

    const text = getText(response);
    if (text) {
      broadcast({ type: "agent_done", steps });
      return { ok: true, steps, output: text };
    }

    broadcast({ type: "agent_done", steps, note: "no_text_no_calls" });
    return { ok: true, steps, output: "(No text and no tool calls returned.)" };
  }

  broadcast({ type: "agent_error", error: "Max tool steps reached" });
  return { ok: false, error: "Max tool steps reached" };
}

// -----------------------------
// API: run agent from UI (text + selectedPath + image)
// -----------------------------
app.post("/api/run", async (req, res) => {
  const prompt = req.body?.prompt;
  const selectedPath = req.body?.selectedPath || null;
  const image = req.body?.image || null; // { mimeType, dataBase64 }

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ ok: false, error: "Missing prompt" });
  }

  broadcast({ type: "run_start" });

  try {
    const result = await runAgentOnce({ prompt, selectedPath, image });
    broadcast({ type: "run_done", ok: result.ok });
    res.status(result.ok ? 200 : 500).json(result);
  } catch (e) {
    broadcast({ type: "run_error", error: e?.message || String(e) });
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// (Optional) compatibility endpoint: POST /run {prompt}
app.post("/run", async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ ok: false, error: "Missing prompt" });
  }

  try {
    const result = await runAgentOnce({ prompt, selectedPath: null, image: null });
    res.status(result.ok ? 200 : 500).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});


// -----------------------------
// Voice input (Web Speech API)
// -----------------------------
const btnMic = document.getElementById("btnMic");
const btnMicStop = document.getElementById("btnMicStop");
const micStatus = document.getElementById("micStatus");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;

function appendToPrompt(text) {
  const current = promptEl.value || "";
  promptEl.value = (current ? current + "\n" : "") + text;
}

btnMic.onclick = () => {
  if (!SpeechRecognition) {
    alert("SpeechRecognition not supported in this browser. Use Chrome/Edge.");
    return;
  }

  rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;

  let finalText = "";

  rec.onstart = () => {
    btnMic.disabled = true;
    btnMicStop.disabled = false;
    micStatus.textContent = "Listening…";
  };

  rec.onerror = (e) => {
    micStatus.textContent = `Mic error: ${e.error}`;
  };

  rec.onend = () => {
    btnMic.disabled = false;
    btnMicStop.disabled = true;
    micStatus.textContent = "";
    if (finalText.trim()) appendToPrompt(finalText.trim());
    finalText = "";
  };

  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += chunk + " ";
      else interim += chunk;
    }
    micStatus.textContent = interim ? `… ${interim}` : "Listening…";
  };

  rec.start();
};

btnMicStop.onclick = () => {
  if (rec) rec.stop();
};

// -----------------------------
// Start server
// -----------------------------
server.listen(PORT, () => {
  console.log(`🚀 Agent daemon running on http://localhost:${PORT}`);
  console.log(`📁 WORKSPACE_ROOT = ${WORKSPACE_ROOT_REAL}`);
});
