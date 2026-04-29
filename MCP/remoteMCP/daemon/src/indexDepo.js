// import "dotenv/config";
// import express from "express";
// import { GoogleGenAI } from "@google/genai";
// import fs from "fs";
// import path from "path";
// import os from "os";
// import http from "http";
// import WebSocket, { WebSocketServer } from "ws";
// import { fileURLToPath } from "url";

// import { toolDecl, toolImpl } from "./tools/toolRegistry.js";

// const PORT = Number(process.env.PORT || 3333);

// const app = express();
// app.use(express.json({ limit: "12mb" })); // allow image base64 payloads
// app.use(express.static("public"));

// // ESM-safe __dirname
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// // --- Validate API key ---
// const apiKey = process.env.GEMINI_API_KEY;
// if (!apiKey) {
//   console.error("❌ GEMINI_API_KEY missing. Put it in daemon/.env as GEMINI_API_KEY=...");
//   process.exit(1);
// }

// // --- Gemini Client ---
// const ai = new GoogleGenAI({ apiKey });

// // --- Load persistent workspace memory ---
// const WORKSPACE_MEMORY_PATH = path.join(__dirname, "prompts", "workspace_memory.txt");
// if (!fs.existsSync(WORKSPACE_MEMORY_PATH)) {
//   console.error(`❌ Missing workspace memory file at: ${WORKSPACE_MEMORY_PATH}`);
//   console.error("Create it at: daemon/src/prompts/workspace_memory.txt");
//   process.exit(1);
// }
// const WORKSPACE_MEMORY = fs.readFileSync(WORKSPACE_MEMORY_PATH, "utf-8");

// // --- Workspace root for the UI file browser ---
// const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT
//   ? path.resolve(process.env.WORKSPACE_ROOT)
//   : process.cwd();

// function safeJoin(relPath) {
//   const abs = path.resolve(WORKSPACE_ROOT, relPath || "");
//   if (!abs.startsWith(WORKSPACE_ROOT)) {
//     throw new Error("Path escapes workspace root");
//   }
//   return abs;
// }

// // --- Web server + WS server ---
// const server = http.createServer(app);
// const wss = new WebSocketServer({ server, path: "/ws" });

// function broadcast(obj) {
//   const msg = typeof obj === "string" ? obj : JSON.stringify(obj);
//   for (const client of wss.clients) {
//     if (client.readyState === WebSocket.OPEN) client.send(msg);
//   }
// }

// wss.on("connection", (ws) => {
//   ws.send(JSON.stringify({ type: "hello", root: WORKSPACE_ROOT }));
// });

// // -----------------------------
// // API: workspace browser
// // -----------------------------
// app.get("/api/root", (req, res) => {
//   res.json({ ok: true, root: WORKSPACE_ROOT, platform: os.platform() });
// });

// app.get("/api/list", (req, res) => {
//   try {
//     const rel = req.query.path ? String(req.query.path) : "";
//     const abs = safeJoin(rel);

//     const entries = fs
//       .readdirSync(abs, { withFileTypes: true })
//       .map((d) => ({
//         name: d.name,
//         type: d.isDirectory() ? "dir" : "file",
//         path: path.join(rel, d.name).replaceAll("\\", "/"),
//       }))
//       .slice(0, 800);

//     res.json({ ok: true, entries, path: rel });
//   } catch (e) {
//     res.status(400).json({ ok: false, error: e.message });
//   }
// });

// app.get("/api/read", (req, res) => {
//   try {
//     const rel = String(req.query.path || "");
//     const abs = safeJoin(rel);
//     const content = fs.readFileSync(abs, "utf-8");
//     res.json({ ok: true, path: rel, content });
//   } catch (e) {
//     res.status(400).json({ ok: false, error: e.message });
//   }
// });

// // -----------------------------
// // Helper: extract function calls robustly
// // -----------------------------
// function getFunctionCalls(response) {
//   // Some SDK versions expose .functionCalls as an array property
//   if (Array.isArray(response?.functionCalls)) return response.functionCalls;

//   // Otherwise inspect candidates[0].content.parts
//   const parts = response?.candidates?.[0]?.content?.parts || [];
//   const calls = [];
//   for (const p of parts) {
//     if (p?.functionCall) calls.push(p.functionCall);
//   }
//   return calls;
// }

// function getText(response) {
//   // Avoid touching response.text too early if tool calls exist.
//   // Prefer candidate parts text aggregation.
//   const parts = response?.candidates?.[0]?.content?.parts || [];
//   const texts = [];
//   for (const p of parts) {
//     if (typeof p?.text === "string" && p.text.trim()) texts.push(p.text);
//   }
//   return texts.join("\n").trim();
// }

// // -----------------------------
// // Agent core: multimodal + tools loop
// // -----------------------------
// async function runAgentOnce({ prompt, selectedPath, image }) {
//   if (image?.dataBase64 && image.dataBase64.length > 6_000_000) {
//     return { ok: false, error: "Image too large (base64 > ~6MB). Use smaller image." };
//   }

//   // OPTIONAL: make “selected file” deterministic:
//   // const selectedDirective = selectedPath ? `First use fs_readFile on: ${selectedPath}\n\n` : "";

//   const augmentedPrompt =
//     (image?.dataBase64 ? "[INPUT_INCLUDES_IMAGE]\n" : "") +
//     (selectedPath ? `[UI_SELECTED_PATH]\n${selectedPath}\n\n` : "") +
//     prompt;

//   const userParts = [{ text: augmentedPrompt }];

//   if (image?.dataBase64) {
//     userParts.push({
//       inlineData: {
//         mimeType: image.mimeType || "image/png",
//         data: image.dataBase64,
//       },
//     });
//   }

//   broadcast({ type: "agent_start" });

//   // We keep a rolling “history” for the tool loop
//   const history = [{ role: "user", parts: userParts }];

//   // 1) First call to Gemini (declare tools)
//   let response = await ai.models.generateContent({
//     model: "gemini-2.0-flash",
//     contents: history,
//     config: {
//       systemInstruction: WORKSPACE_MEMORY,
//       tools: [{ functionDeclarations: toolDecl }],
//     },
//   });

//   const maxSteps = 12;
//   let steps = 0;

//   while (steps < maxSteps) {
//     steps++;

//     // 1) Check for tool calls FIRST (prevents SDK “non-text parts” spam)
//     const calls = getFunctionCalls(response);
//     if (calls.length) {
//       broadcast({ type: "tool_calls", steps, count: calls.length, calls });

//       // Add the model’s functionCall parts to history
//       history.push({ role: "model", parts: calls.map((c) => ({ functionCall: c })) });

//       // Execute calls and gather tool responses
//       const toolResponseParts = [];
//       for (const call of calls) {
//         const name = call.name;
//         const args = call.args || {};

//         const fn = toolImpl[name];
//         if (!fn) {
//           const err = { ok: false, error: `Unknown tool: ${name}` };
//           toolResponseParts.push({ functionResponse: { name, response: err } });
//           broadcast({ type: "tool_result", name, ok: false, error: err.error });
//           continue;
//         }

//         broadcast({ type: "tool_call", name, args });

//         try {
//           const result = await fn(args);
//           toolResponseParts.push({ functionResponse: { name, response: result } });
//           broadcast({ type: "tool_result", name, ok: true });
//         } catch (e) {
//           const err = { ok: false, error: e?.message || String(e) };
//           toolResponseParts.push({ functionResponse: { name, response: err } });
//           broadcast({ type: "tool_result", name, ok: false, error: err.error });
//         }
//       }

//       // Add tool responses to history
//       history.push({ role: "user", parts: toolResponseParts });

//       // Ask Gemini again with updated history
//       response = await ai.models.generateContent({
//         model: "gemini-2.0-flash",
//         contents: history,
//         config: {
//           systemInstruction: WORKSPACE_MEMORY,
//           tools: [{ functionDeclarations: toolDecl }],
//         },
//       });

//       continue;
//     }

//     // 2) No tool calls: now attempt to get text safely
//     const text = getText(response);
//     if (text) {
//       broadcast({ type: "agent_done", steps });
//       return { ok: true, steps, output: text };
//     }

//     // 3) No tool calls and no text
//     broadcast({ type: "agent_done", steps, note: "no_text_no_calls" });
//     return { ok: true, steps, output: "(No text and no tool calls returned.)" };
//   }

//   broadcast({ type: "agent_error", error: "Max tool steps reached" });
//   return { ok: false, error: "Max tool steps reached" };
// }

// // -----------------------------
// // API: run agent from UI (text + selectedPath + image)
// // -----------------------------
// app.post("/api/run", async (req, res) => {
//   const prompt = req.body?.prompt;
//   const selectedPath = req.body?.selectedPath || null;
//   const image = req.body?.image || null; // { mimeType, dataBase64 }

//   if (!prompt || typeof prompt !== "string") {
//     return res.status(400).json({ ok: false, error: "Missing prompt" });
//   }

//   broadcast({ type: "run_start" });

//   try {
//     const result = await runAgentOnce({ prompt, selectedPath, image });
//     broadcast({ type: "run_done", ok: result.ok });
//     res.status(result.ok ? 200 : 500).json(result);
//   } catch (e) {
//     broadcast({ type: "run_error", error: e?.message || String(e) });
//     res.status(500).json({ ok: false, error: e?.message || String(e) });
//   }
// });

// // (Optional) compatibility endpoint: POST /run {prompt}
// app.post("/run", async (req, res) => {
//   const prompt = req.body?.prompt;
//   if (!prompt || typeof prompt !== "string") {
//     return res.status(400).json({ ok: false, error: "Missing prompt" });
//   }

//   try {
//     const result = await runAgentOnce({ prompt, selectedPath: null, image: null });
//     res.status(result.ok ? 200 : 500).json(result);
//   } catch (e) {
//     res.status(500).json({ ok: false, error: e?.message || String(e) });
//   }
// });

// // -----------------------------
// // Start server
// // -----------------------------
// server.listen(PORT, () => {
//   console.log(`🚀 Agent daemon running on http://localhost:${PORT}`);
//   console.log(`📁 WORKSPACE_ROOT = ${WORKSPACE_ROOT}`);
// });
