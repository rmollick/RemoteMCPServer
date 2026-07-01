import { installLevelGenRoutes } from "./levelgenRoutes.js";
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

installLevelGenRoutes(app);

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Model provider config ---
const DEFAULT_PROVIDER = process.env.MODEL_PROVIDER || "gemini";
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3:4b, gemma4:e2b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

function envList(name, fallback) {
  return String(process.env[name] || fallback)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

const GEMINI_MODELS = envList("GEMINI_MODELS", DEFAULT_GEMINI_MODEL);
const OLLAMA_MODELS = envList("OLLAMA_MODELS", DEFAULT_OLLAMA_MODEL);

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "insert key") {
    throw new Error("Missing GEMINI_API_KEY in daemon/.env");
  }

  return new GoogleGenAI({ apiKey });
}

function getModelChoice(provider, model) {
  const selectedProvider = provider || DEFAULT_PROVIDER;

  if (selectedProvider === "gemini") {
    return {
      provider: "gemini",
      model: model || DEFAULT_GEMINI_MODEL,
    };
  }

  if (selectedProvider === "ollama") {
    return {
      provider: "ollama",
      model: model || DEFAULT_OLLAMA_MODEL,
    };
  }

  throw new Error(`Unknown model provider: ${selectedProvider}`);
}

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

async function callOllamaGenerate({ prompt, model, systemInstruction, image }) {
  const body = {
    model,
    prompt,
    stream: false,
    system: systemInstruction,
  };

  // Only send images to Ollama if you intentionally enable it.
  // Some local models do not support image input.
  if (process.env.OLLAMA_SEND_IMAGES === "true" && image?.dataBase64) {
    body.images = [image.dataBase64];
  }

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama failed: ${errorText}`);
  }

  const data = await response.json();
  return data.response || "";
}

function readSelectedFilePreviews(selectedPaths = []) {
  const files = Array.isArray(selectedPaths) ? selectedPaths.slice(0, 8) : [];
  const previews = [];

  for (const selectedPath of files) {
    try {
      const abs = safeJoin(selectedPath);

      if (!fs.existsSync(abs)) continue;

      const content = fs.readFileSync(abs, "utf-8").slice(0, 12000);

      previews.push({
        path: selectedPath,
        content
      });
    } catch {
      // Ignore unreadable files and continue evaluating the rest.
    }
  }

  return previews;
}

async function runOllamaOnce({ prompt, selectedPaths = [], image, model }) {
  const selectedFiles = readSelectedFilePreviews(selectedPaths);

  const selectedFilesText = selectedFiles
    .map(
      (file) =>
        `SELECTED FILE PATH:\n${file.path}\nSELECTED FILE CONTENT:\n${file.content}`
    )
    .join("\n\n");
  const localPrompt = `
  You are running locally through Ollama.
  Use the workspace memory and selected file context to answer the user.

  ${selectedFilesText ? `SELECTED REFERENCE FILES:\n${selectedFilesText}\n` : ""}

  USER REQUEST:
  ${prompt}
  `;

  broadcast({ type: "agent_start", provider: "ollama", model });

  const output = await callOllamaGenerate({
    prompt: localPrompt,
    model,
    systemInstruction: WORKSPACE_MEMORY,
    image,
  });

  broadcast({ type: "agent_done", provider: "ollama", model, steps: 1 });

  return {
    ok: true,
    provider: "ollama",
    model,
    steps: 1,
    output,
  };
}

// -----------------------------
// Agent core: multimodal + tools loop
// -----------------------------
async function runGeminiAgentOnce({ prompt, selectedPaths = [], image, model }) {
  const ai = getGeminiClient();
  if (image?.dataBase64 && image.dataBase64.length > 6_000_000) {
    return { ok: false, error: "Image too large (base64 > ~6MB). Use smaller image." };
  }

  // Keep selectedPath as context only (do NOT trust it as a filesystem path here)
  // Your tools should enforce WORKSPACE_ROOT sandboxing.
  const selectedFilesContext = selectedPaths.length
    ? `[UI_SELECTED_PATHS]\n${selectedPaths.join("\n")}\n\n`
    : "";

  const augmentedPrompt =
    (image?.dataBase64 ? "[INPUT_INCLUDES_IMAGE]\n" : "") +
    selectedFilesContext +
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
    model,
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
        model,
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

async function runAgentOnce({ prompt, selectedPaths = [], image, provider, model }) {
  const choice = getModelChoice(provider, model);

  broadcast({
    type: "model_selected",
    provider: choice.provider,
    model: choice.model,
  });

  if (choice.provider === "ollama") {
    return await runOllamaOnce({
      prompt,
      selectedPaths,
      image,
      model: choice.model,
    });
  }

  if (choice.provider === "gemini") {
    return await runGeminiAgentOnce({
      prompt,
      selectedPaths,
      image,
      model: choice.model,
    });
  }

  throw new Error(`Unsupported provider: ${choice.provider}`);
}

// -----------------------------
// API: run agent from UI (text + selectedPath + image)
// -----------------------------
app.get("/api/models", (req, res) => {
  res.json({
    ok: true,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModels: {
      gemini: DEFAULT_GEMINI_MODEL,
      ollama: DEFAULT_OLLAMA_MODEL,
    },
    providers: {
      gemini: GEMINI_MODELS,
      ollama: OLLAMA_MODELS,
    },
  });
});

app.post("/api/run", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();

  if (!prompt) {
    return res.status(400).json({
      ok: false,
      error: "Missing prompt"
    });
  }

  const selectedPath = req.body?.selectedPath || null;

  const selectedPaths = Array.isArray(req.body?.selectedPaths)
    ? req.body.selectedPaths
    : selectedPath
      ? [selectedPath]
      : [];

  const image = req.body?.image || null;
  const provider = req.body?.provider || DEFAULT_PROVIDER;
  const model = req.body?.model || null;

  broadcast({ type: "run_start" });

  try {
    const result = await runAgentOnce({
      prompt,
      selectedPaths,
      image,
      provider,
      model,
    });

    broadcast({ type: "run_done", ok: result.ok });
    res.status(result.ok ? 200 : 500).json(result);
  } catch (e) {
    broadcast({ type: "run_error", error: e?.message || String(e) });

    res.status(500).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
});

// (Optional) compatibility endpoint: POST /run {prompt}
app.post("/run", async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ ok: false, error: "Missing prompt" });
  }

  try {
    const result = await runAgentOnce({
      prompt,
      selectedPaths: [],
      image: null,
      provider: DEFAULT_PROVIDER,
      model: null
    });    
    res.status(result.ok ? 200 : 500).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/evaluate-unity-script", async (req, res) => {
  const script = String(req.body?.script || "").trim();
  const selectedPaths = Array.isArray(req.body?.selectedPaths)
    ? req.body.selectedPaths.slice(0, 8)
    : [];

  const provider = req.body?.provider || DEFAULT_PROVIDER;
  const model = req.body?.model || null;

  if (!script) {
    return res.status(400).json({
      ok: false,
      error: "Missing Unity script."
    });
  }

  try {
    const choice = getModelChoice(provider, model);
    const selectedFiles = readSelectedFilePreviews(selectedPaths);

    const referenceText = selectedFiles
      .map(
        (file) =>
          `REFERENCE FILE: ${file.path}\n${file.content}`
      )
      .join("\n\n");

    const evaluationPrompt = `
You are reviewing a proposed Unity C# script for a Cerebrum project.

Evaluate it for:
1. C# syntax and likely Unity compile errors.
2. Missing namespaces, types, methods, or references.
3. Compatibility with the selected project reference files.
4. Whether it should be attached to a GameObject and any Inspector setup needed.
5. Clear fixes before using it in Unity.

Do not write files.
Do not call tools.
Return a concise report with these headings:
VERDICT
LIKELY ISSUES
UNITY SETUP
RECOMMENDED FIXES
TEST PLAN

SELECTED PROJECT REFERENCES:
${referenceText || "(No files selected.)"}

UNITY SCRIPT TO EVALUATE:
${script}
`;

    let output = "";

    if (choice.provider === "ollama") {
      output = await callOllamaGenerate({
        prompt: evaluationPrompt,
        model: choice.model,
        systemInstruction: WORKSPACE_MEMORY,
        image: null
      });
    } else {
      const ai = getGeminiClient();

      const response = await ai.models.generateContent({
        model: choice.model,
        contents: [{ role: "user", parts: [{ text: evaluationPrompt }] }],
        config: {
          systemInstruction: WORKSPACE_MEMORY
        }
      });

      output = getText(response);
    }

    res.json({
      ok: true,
      provider: choice.provider,
      model: choice.model,
      output
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
// -----------------------------
// Start server
// -----------------------------
server.listen(PORT, () => {
  console.log(`🚀 Agent daemon running on http://localhost:${PORT}`);
  console.log(`📁 WORKSPACE_ROOT = ${WORKSPACE_ROOT_REAL}`);
});
