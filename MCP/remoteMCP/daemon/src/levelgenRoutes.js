import fs from "fs";
import path from "path";
import multer from "multer";
import {
  ROOM_CONSTRAINTS,
  guardLevelGenPrompt,
  validateLevelGen
} from "./levelgenConstraints.js";

const upload = multer({ storage: multer.memoryStorage() });

const PROJECT_ROOT =
  process.env.CEREBRUM_PROJECT_ROOT ||
  process.env.WORKSPACE_ROOT ||
  "C:\\CerebrumProjectSasan-main\\CerebrumProjectSasan-main";

const STREAMING_ASSETS_DIR = path.join(PROJECT_ROOT, "Assets", "StreamingAssets");
const SCENARIOS_DIR = path.join(STREAMING_ASSETS_DIR, "Scenarios");
const LEVELGEN_DIR = path.join(STREAMING_ASSETS_DIR, "LevelGen");

const DAEMON_ROOT = process.cwd();
const LOCAL_MANUAL_DIR = path.join(DAEMON_ROOT, "manual-levelgen-examples");
const LOCAL_CORRECTED_DIR = path.join(DAEMON_ROOT, "corrected-levelgen-examples");
const LOCAL_SCENARIO_DIR = path.join(DAEMON_ROOT, "Scenario");
const LOCAL_PATIENT_DIR = path.join(DAEMON_ROOT, "Patient");
const MEMORY_PATH = path.join(DAEMON_ROOT, "Workspace Memory.txt");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || process.env.LOCAL_MODEL || "gemma3:4b";

const MAX_FILE_CHARS = 9000;
const MAX_MEMORY_CHARS = 20000;
const MAX_CONTEXT_CHARS = 42000;
const DEFAULT_TOP_K = 12;

const READABLE_EXTENSIONS = new Set([
  ".txt", ".csv", ".json", ".xml", ".yaml", ".yml", ".md", ".ini", ".cfg"
]);

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readTextSafe(filePath, maxChars = MAX_FILE_CHARS) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!READABLE_EXTENSIONS.has(ext)) return "";
    return fs.readFileSync(filePath, "utf8").slice(0, maxChars);
  } catch {
    return "";
  }
}

function walkFiles(dir, bucket = []) {
  if (!exists(dir)) return bucket;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", ".git", "Library", "Temp", "obj", "Build"].includes(entry.name)) continue;
      walkFiles(fullPath, bucket);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (READABLE_EXTENSIONS.has(ext)) bucket.push(fullPath);
    }
  }

  return bucket;
}

function projectRelative(filePath) {
  if (filePath.startsWith(PROJECT_ROOT)) return path.relative(PROJECT_ROOT, filePath);
  return path.relative(DAEMON_ROOT, filePath);
}

function getAllKnowledgeFiles() {
  const files = [];

  files.push(...walkFiles(STREAMING_ASSETS_DIR));
  files.push(...walkFiles(LOCAL_MANUAL_DIR));
  files.push(...walkFiles(LOCAL_CORRECTED_DIR));
  files.push(...walkFiles(LOCAL_SCENARIO_DIR));
  files.push(...walkFiles(LOCAL_PATIENT_DIR));

  return [...new Set(files)]
    .map((filePath) => {
      const text = readTextSafe(filePath);
      const rel = projectRelative(filePath);
      const relLower = rel.toLowerCase();

      const priority = filePath.includes("corrected-levelgen-examples")
        ? 1000
        : filePath.includes("manual-levelgen-examples")
          ? 800
          : relLower.includes("levelgen")
            ? 300
            : relLower.includes("scenario")
              ? 200
              : relLower.includes("patient")
                ? 200
                : 100;

      return {
        path: filePath,
        rel,
        size: text.length,
        priority,
        text
      };
    })
    .filter((f) => f.text.trim().length > 0);
}

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\/\\.-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function scoreFile(file, prompt, mode) {
  const hay = (file.rel + "\n" + file.text).toLowerCase();
  const words = tokenize(prompt);
  let score = file.priority;

  for (const word of words) {
    if (hay.includes(word)) score += 20;
  }

  const rel = file.rel.toLowerCase();

  if (mode === "levelgen" && rel.includes("levelgen")) score += 500;
  if (mode === "levelgen" && rel.includes("corrected")) score += 1000;
  if (mode === "levelgen" && rel.includes("manual-levelgen")) score += 500;

  if (mode === "scenario" && rel.includes("scenario")) score += 500;
  if (mode === "scenario" && file.text.includes("Do '")) score += 250;

  if (mode === "character" && (rel.includes("patient") || rel.includes("appearance"))) score += 700;
  if (mode === "character" && rel.includes("createpatient")) score += 400;
  if (mode === "character" && rel.includes("initializepatientappearance")) score += 500;

  return score;
}

function buildContext({ prompt, mode, selectedPaths = [], topK = DEFAULT_TOP_K }) {
  const memoryPath = mode === "scenario"
    ? path.join(path.dirname(MEMORY_PATH), "Workspace Memory Scenario.txt")
    : MEMORY_PATH;
  const memory = exists(memoryPath) ? readTextSafe(memoryPath, MAX_MEMORY_CHARS) : "";
  const all = getAllKnowledgeFiles();

  const selectedSet = new Set(selectedPaths || []);
  const selected = all.filter((f) => selectedSet.has(f.path) || selectedSet.has(f.rel));

  const ranked = all
    .filter((f) => !selected.includes(f))
    .map((f) => ({ ...f, score: scoreFile(f, prompt, mode) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(topK) || DEFAULT_TOP_K);

  const finalFiles = [...selected, ...ranked];

  let context = `WORKSPACE MEMORY:\n${memory}\n\nREFERENCE FILES START\n`;

  for (const f of finalFiles) {
    const block = `\n--- FILE: ${f.rel} ---\n${f.text}\n`;
    if ((context + block).length > MAX_CONTEXT_CHARS) break;
    context += block;
  }

  context += "\nREFERENCE FILES END\n";

  if (mode === "scenario") {
    const levelgenOutputDir = getOutputDir("levelgen");
    const activeLevelGenPath = path.join(levelgenOutputDir, "ActiveGeneratedLevelGen.txt");
    if (exists(activeLevelGenPath)) {
      const activeText = readTextSafe(activeLevelGenPath);
      if (activeText.trim()) {
        context = `GENERATED LEVELGEN LAYOUT (YOU MUST MATCH THIS EXACT LAYOUT):\n${activeText}\n\n${context}`;
      }
    }
  }

  return {
    context,
    files: finalFiles.map(({ rel, path, size, priority, score }) => ({
      rel,
      path,
      size,
      priority,
      score
    }))
  };
}

function cleanGenerated(text) {
  return (text || "")
    .replace(/```txt/gi, "")
    .replace(/```cerebrum/gi, "")
    .replace(/```/g, "")
    .replace(/^Here is.*$/gim, "")
    .replace(/^Sure[,!]?.*$/gim, "")
    .trim();
}

function safeFileName(name) {
  const cleaned = (name || "GeneratedFile")
    .replace(/[^a-z0-9_\- ]/gi, "")
    .trim()
    .replace(/\s+/g, "_");

  return cleaned || "GeneratedFile";
}

function getOutputDir(mode) {
  if (mode === "levelgen") {
    return process.env.LEVELGEN_OUTPUT_DIR || path.join(LEVELGEN_DIR, "Generated");
  }

  if (mode === "character") {
    return process.env.CHARACTER_OUTPUT_DIR || path.join(SCENARIOS_DIR, "Generated", "Character");
  }

  return process.env.SCENARIO_OUTPUT_DIR || path.join(SCENARIOS_DIR, "Generated");
}

function activeFileName(mode) {
  if (mode === "levelgen") return "ActiveGeneratedLevelGen.txt";
  if (mode === "character") return "ActiveGeneratedCharacter.txt";
  return "ActiveGeneratedScenario.txt";
}

function resolveSafeFilePath(inputPath, defaultDir) {
  if (!inputPath) return null;
  const raw = String(inputPath).trim();
  if (path.isAbsolute(raw)) {
    return path.normalize(raw);
  }
  return path.resolve(defaultDir || PROJECT_ROOT, raw);
}

function localEvaluate(script, mode, expectedRoomName = null) {
  const errors = [];
  const warnings = [];

  const lines = String(script || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!String(script || "").trim()) errors.push("Generated file is empty.");
  if (String(script || "").includes("```")) errors.push("Generated file still contains markdown code fences.");

  if (mode === "scenario") {
    const validStarts = ["Do '", "Prompt '", "Wait ", "Return", "Label '", "Goto '", "If ", "Else", "Endif", "$", "//", "#"];

    for (const line of lines) {
      if (!validStarts.some((prefix) => line.startsWith(prefix))) {
        warnings.push(`Unusual scenario line: ${line}`);
      }
    }

    if (!lines.some((l) => l.startsWith("Do '"))) warnings.push("No Do statements found.");
    if (lines.length > 0 && !lines[lines.length - 1]?.startsWith("Return")) warnings.push("Script does not end with Return.");
  }

  if (mode === "character") {
    if (!lines.some((l) => l.includes("Patient") || l.includes("$Patient"))) {
      warnings.push("Character output does not appear to reference a patient.");
    }
  }

  if (mode === "levelgen") {
    return validateLevelGen(script, expectedRoomName);
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings
  };
}

async function callOllama(body) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama failed: ${errorText}`);
  }

  return response.json();
}

function outputRulesForMode(mode, roomName) {
  if (mode === "levelgen") {
    return `Generate a LevelGen room file. Output only raw tab-separated LevelGen rows. The first row must be Room<TAB>0<TAB>${roomName}. Use only valid room slots, parent prefabs, child slots, and child prefabs from the workspace constraints. Never invent unsupported objects or slots.`;
  }

  if (mode === "character") {
    return "Generate a Cerebrum scenario script (.txt) for patient/character setup and styling. Output only raw script lines following the Cerebrum Scripting Guide. Initialize patient variables (e.g., $PatientName = '...', $PatientAge = 87, $Temperature = 36.5, $HR = 70, $BP = '150/71', $Respiration = 20, $SpO2 = 100, $PatientSpeak = '...') and call styling/appearance Do scripts (e.g., Do 'NEWS_Nurse/PatientCreations/Age/75' or Do $Patient SetHairColor Dark) referencing the bed location and patient reference variables. Do not generate LevelGen room layout rows or unrelated scenario clinical actions.";
  }

  return "Generate a Cerebrum scenario .txt file. Output only raw script lines. Use Do statements for real actions and Prompt only for visible dialogue. Do not generate LevelGen rows or character appearance configuration unless the scenario syntax requires a patient reference.";
}

function buildSequentialTasks(userPrompt) {
  return {
    title: "Sequential Simulation Plan",
    goal: "Fulfill the user request sequentially",
    levelgen_task: `Generate the physical room/environment setup only. Do not write scenario behavior or detailed character appearance. Overall request:\n${userPrompt}`,
    character_task: `Generate the patient/character setup and appearance customization only. Do not generate LevelGen rows or scenario behavior. Overall request:\n${userPrompt}`,
    scenario_task: `Generate scenario clinical flow and logic only. Do not generate LevelGen layout or character appearance. Overall request:\n${userPrompt}`
  };
}

async function runOrchestrator(userPrompt, roomName, componentConfigs = {}) {
  let targetDetails = "";
  if (componentConfigs?.levelgen?.action === "edit") {
    targetDetails += `\n- LevelGen Component: EDIT existing file (${componentConfigs.levelgen.targetPath || "selected layout"}).`;
  }
  if (componentConfigs?.character?.action === "edit") {
    targetDetails += `\n- Character Component: EDIT existing file (${componentConfigs.character.targetPath || "selected character"}).`;
  }
  if (componentConfigs?.scenario?.action === "edit") {
    targetDetails += `\n- Scenario Component: EDIT existing file (${componentConfigs.scenario.targetPath || "selected scenario"}).`;
  }

  const prompt = `
You are the Manager/Orchestrator Agent for a Unity Cerebrum simulation creation pipeline.
Your job is to read the user request and generate a single unified Master Simulation Plan.
This plan must outline the overall goals, and divide the requirements into a list of clear, structured tasks for 3 specialized sub-agents:
1. LevelGen Agent ("levelgen_task"): For generating or modifying the physical environment and layout (specifying Room, Location, child items matching available slots and hard constraints).
   CRITICAL CONSTRAINT FOR RoomMedExam_base: RoomMedExam_base ONLY supports: Bed (1, 2, 3), Wall (1, 2, 3), BedsideHead (1, 2), BedsideMid (1, 2), BedsideFoot (1, 2), Cart (1, 2), and Screen (1, 2, 3, 4).
   NEVER ask to place a Nurse, Nurse Station, Doctor, Chair, Desk, Bin, Cabinet, or BedsideHeadLeft in RoomMedExam_base. Physical layouts do not contain actor characters; character placement and actions are handled purely in character/scenario scripts.
2. Character Agent ("character_task"): For creating or modifying the character/patient setup script, setting patient name, age, vitals variables ($Temperature, $HR, $BP, $Respiration, $SpO2), character dialogue ($PatientSpeak), and styling appearance Do calls (e.g. SetHairColor, SetHairStyle, setblend, rigs) following the Cerebrum Scripting Guide.
3. Scenario Agent ("scenario_task"): For scripting clinical workflow logic (using Do statements for actions/dialogue, Prompt statements, Wait statements, conditionals, choices, and ending with Return).

${roomName ? `Target Room: ${roomName}` : ""}
${targetDetails ? `COMPONENT SPECIFICATIONS:${targetDetails}` : ""}

OVERALL USER REQUEST:
${userPrompt}

You MUST return a JSON object with this exact schema:
{
  "title": "A short descriptive title for the Master Plan",
  "goal": "Overview of what this simulation accomplishes",
  "levelgen_task": "Detailed, specific tasks for the physical level setup...",
  "character_task": "Detailed, specific tasks for setting patient details, vitals variables, speech, and look styling...",
  "scenario_task": "Detailed, specific tasks for the scenario clinical flow, actions, prompts, and conditions..."
}
Do not return any explanations, note blocks, or markdown code fences (like \`\`\`json). Just the raw JSON.
`;

  try {
    const data = await callOllama({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      format: "json"
    });
    const text = cleanGenerated(data.response || "{}");
    return JSON.parse(text);
  } catch (err) {
    console.warn("⚠️ Failed to parse orchestrator plan, falling back to sequential default tasks:", err);
    return buildSequentialTasks(userPrompt);
  }
}

async function generateOneMode({
  mode,
  userPrompt,
  fileName,
  selectedPaths,
  topK,
  imageBase64 = null,
  roomName = "RoomMedExam_base",
  strictConstraints = true,
  additionalContext = "",
  action = "create",
  targetPath = null,
  existingContent = null
}) {
  if (!userPrompt.trim()) {
    return {
      blocked: true,
      status: 400,
      stage: "input",
      error: "Prompt is required."
    };
  }

  // If editing an existing file and existingContent wasn't passed directly, load it
  let baseContent = existingContent;
  if (action === "edit" && !baseContent && targetPath && exists(targetPath)) {
    baseContent = readTextSafe(targetPath, MAX_FILE_CHARS);
  }

  if (mode === "levelgen" && strictConstraints && action !== "edit") {
    const promptProblems = guardLevelGenPrompt(userPrompt, roomName);
    if (promptProblems.length > 0) {
      return {
        blocked: true,
        status: 400,
        stage: "prompt-guard",
        error: "IMPOSSIBLE_LEVELGEN_REQUEST",
        roomName,
        problems: promptProblems
      };
    }
  }

  const { context, files } = buildContext({
    prompt: userPrompt,
    mode,
    selectedPaths: targetPath ? [...(selectedPaths || []), targetPath] : selectedPaths,
    topK
  });

  let prompt = `
You are connected to a local Unity/Cerebrum project.
You must generate files based on the reference project files below.

${context}
`;

  if (baseContent) {
    prompt += `
[EXISTING ${mode.toUpperCase()} FILE TO EDIT]
--- START EXISTING CONTENT ---
${baseContent}
--- END EXISTING CONTENT ---
INSTRUCTION FOR EDITING:
Modify the above existing file to implement the user request. Keep all valid parts and structures that don't need changes.
`;
  }

  if (additionalContext) {
    prompt += `\n[ADDITIONAL PIPELINE CONTEXT]\n${additionalContext}\n`;
  }

  prompt += `
TASK MODE: ${mode} (${action === "edit" ? "EDIT EXISTING FILE" : "CREATE NEW FILE"})
${mode === "levelgen" ? `SELECTED ROOM: ${roomName}` : ""}
USER REQUEST:
${userPrompt}

OUTPUT RULES:
${outputRulesForMode(mode, roomName)}
Do not explain.
Do not use markdown.
Do not invent a different file format.
If unsure, copy the structure from the most relevant corrected/manual examples.
`;

  const ollamaBody = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false
  };

  if (imageBase64) {
    ollamaBody.images = [imageBase64];
  }

  const data = await callOllama(ollamaBody);
  const script = cleanGenerated(data.response || "");
  const evaluation = localEvaluate(script, mode, mode === "levelgen" ? roomName : null);

  if (mode === "levelgen" && strictConstraints && !evaluation.pass) {
    return {
      blocked: true,
      status: 422,
      stage: "output-validator",
      error: "GENERATED_LEVELGEN_FAILED_HARD_CONSTRAINTS",
      roomName,
      script,
      localEvaluation: evaluation,
      usedFiles: files
    };
  }

  const outputDir = getOutputDir(mode);
  fs.mkdirSync(outputDir, { recursive: true });

  const safeName = safeFileName(fileName);
  let savedPath;
  if (action === "edit" && targetPath) {
    savedPath = resolveSafeFilePath(targetPath, outputDir);
    fs.mkdirSync(path.dirname(savedPath), { recursive: true });
    fs.writeFileSync(savedPath, script, "utf8");
  } else {
    savedPath = path.join(outputDir, `${safeName}.txt`);
    fs.writeFileSync(savedPath, script, "utf8");
  }

  const activePath = path.join(outputDir, activeFileName(mode));
  fs.writeFileSync(activePath, script, "utf8");

  return {
    blocked: false,
    action: action === "edit" ? "edited" : "created",
    targetPath: savedPath,
    script,
    savedPath,
    activePath,
    mode,
    model: OLLAMA_MODEL,
    roomName: mode === "levelgen" ? roomName : undefined,
    usedFiles: files,
    localEvaluation: evaluation
  };
}

export function installLevelGenRoutes(app) {
  app.get("/api/status", (req, res) => {
    const files = getAllKnowledgeFiles();

    res.json({
      projectRoot: PROJECT_ROOT,
      streamingAssetsDir: STREAMING_ASSETS_DIR,
      scenariosDir: SCENARIOS_DIR,
      levelgenDir: LEVELGEN_DIR,
      localManualDir: LOCAL_MANUAL_DIR,
      localCorrectedDir: LOCAL_CORRECTED_DIR,
      localScenarioDir: LOCAL_SCENARIO_DIR,
      localPatientDir: LOCAL_PATIENT_DIR,
      memoryPath: MEMORY_PATH,
      memoryCharsLoaded: exists(MEMORY_PATH) ? readTextSafe(MEMORY_PATH, MAX_MEMORY_CHARS).length : 0,
      model: OLLAMA_MODEL,
      ollamaUrl: OLLAMA_URL,
      supportedRooms: Object.keys(ROOM_CONSTRAINTS),
      fileCount: files.length,
      sampleFiles: files.slice(0, 30).map((f) => ({
        rel: f.rel,
        path: f.path,
        size: f.size
      }))
    });
  });

  app.get("/api/files", (req, res) => {
    const mode = req.query.mode || "scenario";
    const prompt = req.query.prompt || "";

    const files = getAllKnowledgeFiles()
      .map((f) => ({ ...f, score: scoreFile(f, prompt, mode) }))
      .sort((a, b) => b.score - a.score)
      .map(({ rel, path, size, priority, score }) => ({
        rel,
        path,
        size,
        priority,
        score
      }));

    res.json({ files });
  });

  app.post("/generate", upload.single("image"), async (req, res) => {
    try {
      const mode = req.body.mode || "scenario";
      const userPrompt = req.body.prompt || "";
      const roomName = req.body.roomName || "RoomMedExam_base";
      const strictConstraints = String(req.body.strictConstraints ?? "true") !== "false";
      const defaultName = mode === "levelgen"
        ? "GeneratedLevel"
        : mode === "character"
          ? "GeneratedCharacter"
          : "GeneratedScenario";
      const fileName = req.body.fileName || defaultName;
      const selectedPaths = req.body.selectedPaths ? JSON.parse(req.body.selectedPaths) : [];
      const topK = Number(req.body.topK || DEFAULT_TOP_K);
      const imageBase64 = req.file ? req.file.buffer.toString("base64") : null;

      const result = await generateOneMode({
        mode,
        userPrompt,
        fileName,
        selectedPaths,
        topK,
        imageBase64,
        roomName,
        strictConstraints
      });

      if (result.blocked) {
        return res.status(result.status || 400).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Server error.",
        details: err.message
      });
    }
  });

  app.get("/api/component-files", (req, res) => {
    try {
      const allFiles = getAllKnowledgeFiles();
      const levelgen = [];
      const character = [];
      const scenario = [];

      for (const f of allFiles) {
        const relLower = f.rel.toLowerCase();
        const baseName = path.basename(f.path);
        const item = {
          name: baseName,
          rel: f.rel,
          path: f.path,
          size: f.size
        };

        if (relLower.includes("levelgen") || baseName.toLowerCase().includes("room")) {
          levelgen.push(item);
        } else if (relLower.includes("patient") || relLower.includes("character")) {
          character.push(item);
        } else if (relLower.includes("scenario")) {
          scenario.push(item);
        }
      }

      // Also ensure active files are listed if they exist
      const activeLg = path.join(getOutputDir("levelgen"), activeFileName("mode"));
      if (exists(activeLg)) {
        levelgen.unshift({ name: "ActiveGeneratedLevelGen.txt", rel: "ActiveGeneratedLevelGen.txt", path: activeLg, size: fs.statSync(activeLg).size });
      }

      res.json({
        ok: true,
        levelgen: [...new Map(levelgen.map((i) => [i.path, i])).values()],
        character: [...new Map(character.map((i) => [i.path, i])).values()],
        scenario: [...new Map(scenario.map((i) => [i.path, i])).values()]
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list component files", details: err.message });
    }
  });

  app.post("/api/save-file", (req, res) => {
    try {
      const { filePath, content, mode, fileName } = req.body;
      if (typeof content !== "string") {
        return res.status(400).json({ error: "content string is required." });
      }

      const outputDir = getOutputDir(mode || "scenario");
      let targetPath;

      if (filePath) {
        targetPath = resolveSafeFilePath(filePath, outputDir);
      } else {
        const safeName = safeFileName(fileName || (mode === "levelgen" ? "SavedLevel" : mode === "character" ? "SavedCharacter" : "SavedScenario"));
        targetPath = path.join(outputDir, `${safeName}.txt`);
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, "utf8");

      if (mode) {
        const activePath = path.join(outputDir, activeFileName(mode));
        fs.writeFileSync(activePath, content, "utf8");
      }

      res.json({
        ok: true,
        savedPath: targetPath,
        bytes: Buffer.byteLength(content, "utf8"),
        mode
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save file.", details: err.message });
    }
  });

  app.post("/api/edit-component", async (req, res) => {
    try {
      const { mode = "scenario", prompt = "", currentContent = "", targetPath = "", roomName = "RoomMedExam_base" } = req.body;
      if (!prompt.trim()) {
        return res.status(400).json({ error: "Edit prompt is required." });
      }

      let existingText = currentContent;
      if (!existingText && targetPath && exists(targetPath)) {
        existingText = readTextSafe(targetPath, MAX_FILE_CHARS);
      }

      const { context } = buildContext({
        prompt,
        mode,
        selectedPaths: targetPath ? [targetPath] : [],
        topK: 6
      });

      const editPrompt = `
You are connected to a local Unity/Cerebrum project as the specialized ${mode.toUpperCase()} component agent.
Your task is to EDIT and REFINE the existing ${mode} script based on the user's instructions.

${context}

EXISTING SCRIPT:
--- BEGIN CURRENT FILE ---
${existingText}
--- END CURRENT FILE ---

USER EDIT INSTRUCTIONS:
${prompt}

RULES:
${outputRulesForMode(mode, roomName)}
Apply only the requested edits or additions while maintaining correct syntax, variables, and structure.
Do not explain.
Do not use markdown code fences.
Output only the complete edited raw script.
`;

      const data = await callOllama({
        model: OLLAMA_MODEL,
        prompt: editPrompt,
        stream: false
      });

      const updatedScript = cleanGenerated(data.response || "");
      const evaluation = localEvaluate(updatedScript, mode, mode === "levelgen" ? roomName : null);

      let savedPath = null;
      if (targetPath) {
        savedPath = resolveSafeFilePath(targetPath, getOutputDir(mode));
        fs.mkdirSync(path.dirname(savedPath), { recursive: true });
        fs.writeFileSync(savedPath, updatedScript, "utf8");
      }

      res.json({
        ok: true,
        mode,
        script: updatedScript,
        savedPath,
        localEvaluation: evaluation
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Component edit error.", details: err.message });
    }
  });

  app.post("/generate-sequential", upload.single("image"), async (req, res) => {
    try {
      const userPrompt = req.body.prompt || "";
      const roomName = req.body.roomName || "RoomMedExam_base";
      const strictConstraints = String(req.body.strictConstraints ?? "true") !== "false";
      const baseName = safeFileName(req.body.fileName || "SequentialGeneration");
      const selectedPaths = req.body.selectedPaths ? JSON.parse(req.body.selectedPaths) : [];
      const topK = Number(req.body.topK || DEFAULT_TOP_K);
      const imageBase64 = req.file ? req.file.buffer.toString("base64") : null;

      let componentConfigs = {};
      if (req.body.componentConfigs) {
        try {
          componentConfigs = typeof req.body.componentConfigs === "string"
            ? JSON.parse(req.body.componentConfigs)
            : req.body.componentConfigs;
        } catch (e) {
          console.warn("Could not parse componentConfigs", e);
        }
      }

      if (!userPrompt.trim()) {
        return res.status(400).json({ error: "Prompt is required." });
      }

      console.log(`🤖 Orchestrator planning started for prompt: "${userPrompt}"`);
      const plan = await runOrchestrator(userPrompt, roomName, componentConfigs);
      console.log(`📋 Orchestrator plan generated:`, JSON.stringify(plan, null, 2));

      // Guard LevelGen sub-prompt specifically using the sub-task description
      const lgConfig = componentConfigs.levelgen || {};
      if (strictConstraints && lgConfig.action !== "edit") {
        const levelGenSubPrompt = plan.levelgen_task || plan.levelgen || userPrompt;
        const promptProblems = guardLevelGenPrompt(levelGenSubPrompt, roomName);
        if (promptProblems.length > 0) {
          return res.status(400).json({
            blocked: true,
            status: 400,
            stage: "prompt-guard",
            error: "IMPOSSIBLE_LEVELGEN_REQUEST",
            roomName,
            problems: promptProblems,
            orchestratorPlan: plan
          });
        }
      }

      const results = {};

      // 1. Run LevelGen Agent
      console.log("🛠️ Running LevelGen Agent...");
      const lgFileName = lgConfig.fileName ? safeFileName(lgConfig.fileName) : `${baseName}_LevelGen`;
      results.levelgen = await generateOneMode({
        mode: "levelgen",
        userPrompt: `You are the LevelGen Agent. Your task is defined in the Master Simulation Plan under "levelgen_task":\n"${plan.levelgen_task || plan.levelgen || userPrompt}"\n\nReference the Master Plan context:\nGoal: ${plan.goal}`,
        fileName: lgFileName,
        selectedPaths,
        topK,
        imageBase64,
        roomName,
        strictConstraints: false,
        additionalContext: `MASTER SIMULATION PLAN:\n${JSON.stringify(plan, null, 2)}`,
        action: lgConfig.action || "create",
        targetPath: lgConfig.targetPath || null,
        existingContent: lgConfig.existingContent || null
      });

      if (results.levelgen.blocked) {
        return res.status(results.levelgen.status || 400).json({
          error: "Sequential generation stopped at LevelGen.",
          stoppedAt: "levelgen",
          orchestratorPlan: plan,
          results
        });
      }

      // 2. Run Character Agent
      console.log("👤 Running Character Agent...");
      const chConfig = componentConfigs.character || {};
      const chFileName = chConfig.fileName ? safeFileName(chConfig.fileName) : `${baseName}_Character`;
      let characterContext = `MASTER SIMULATION PLAN:\n${JSON.stringify(plan, null, 2)}`;
      if (results.levelgen?.script) {
        characterContext += `\n\nGENERATED LEVELGEN LAYOUT (YOU MUST COORDINATE AND PLACE PATIENT IN A SUPPORTED BED/SLOT DETECTED HERE):\n${results.levelgen.script}`;
      }

      results.character = await generateOneMode({
        mode: "character",
        userPrompt: `You are the Character Agent. Your task is defined in the Master Simulation Plan under "character_task":\n"${plan.character_task || plan.character || userPrompt}"\n\nReference the Master Plan context:\nGoal: ${plan.goal}`,
        fileName: chFileName,
        selectedPaths,
        topK,
        imageBase64: null,
        roomName,
        strictConstraints: false,
        additionalContext: characterContext,
        action: chConfig.action || "create",
        targetPath: chConfig.targetPath || null,
        existingContent: chConfig.existingContent || null
      });

      if (results.character.blocked) {
        return res.status(results.character.status || 400).json({
          error: "Sequential generation stopped at Character.",
          stoppedAt: "character",
          orchestratorPlan: plan,
          results
        });
      }

      // 3. Run Scenario Agent with context from LevelGen and Character outputs
      console.log("🎬 Running Scenario Agent...");
      const scConfig = componentConfigs.scenario || {};
      const scFileName = scConfig.fileName ? safeFileName(scConfig.fileName) : `${baseName}_Scenario`;
      let scenarioContext = `MASTER SIMULATION PLAN:\n${JSON.stringify(plan, null, 2)}`;
      if (results.levelgen?.script) {
        scenarioContext += `\n\nGENERATED LEVELGEN LAYOUT (YOU MUST MATCH THIS EXACT LAYOUT AND SLOTS/PREFABS):\n${results.levelgen.script}`;
      }
      if (results.character?.script) {
        scenarioContext += `\n\nGENERATED CHARACTER SETUP (YOU MUST INTEGRATE OR REFER TO THESE VARIABLES):\n${results.character.script}`;
      }

      results.scenario = await generateOneMode({
        mode: "scenario",
        userPrompt: `You are the Scenario Agent. Your task is defined in the Master Simulation Plan under "scenario_task":\n"${plan.scenario_task || plan.scenario || userPrompt}"\n\nReference the Master Plan context:\nGoal: ${plan.goal}`,
        fileName: scFileName,
        selectedPaths,
        topK,
        imageBase64: null,
        roomName,
        strictConstraints: false,
        additionalContext: scenarioContext,
        action: scConfig.action || "create",
        targetPath: scConfig.targetPath || null,
        existingContent: scConfig.existingContent || null
      });

      if (results.scenario.blocked) {
        return res.status(results.scenario.status || 400).json({
          error: "Sequential generation stopped at Scenario.",
          stoppedAt: "scenario",
          orchestratorPlan: plan,
          results
        });
      }

      res.json({
        ok: true,
        orchestratorPlan: plan,
        order: ["levelgen", "character", "scenario"],
        results
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Sequential generation error.",
        details: err.message
      });
    }
  });

  app.post("/evaluate", async (req, res) => {
    try {
      const mode = req.body.mode || "scenario";
      const script = req.body.script || "";
      const prompt = req.body.prompt || "Evaluate this generated file.";
      const roomName = req.body.roomName || "RoomMedExam_base";

      const { context, files } = buildContext({
        prompt,
        mode,
        selectedPaths: [],
        topK: 8
      });

      const local = localEvaluate(script, mode, mode === "levelgen" ? roomName : null);

      const evalPrompt = `
You are an expert system that evaluates Unity LevelGen scripts for correctness.

[CONTEXT PROJECT EXAMPLES]
${context}

[GENERATED FILE TO EVALUATE]
${script}

[LOCAL SYNTAX CHECK RESULTS]
${JSON.stringify(local, null, 2)}

[INSTRUCTION]
Evaluate the generated ${mode} file against the project examples.
You MUST return a JSON object with the following schema:
{
  "score": <number between 0 and 100 representing quality>,
  "pass": <true if the script is correct and ready to use, false if it has errors>,
  "problems": <array of strings describing any issues found>,
  "fixes": <array of strings describing how to fix the issues>,
  "corrected_version": <string containing the corrected version of the script>
}
Do not return any other text, explanations, or keys. Only return the JSON object.
`;

      const data = await callOllama({
        model: OLLAMA_MODEL,
        prompt: evalPrompt,
        stream: false,
        format: "json"
      });

      let modelEvaluation;

      try {
        modelEvaluation = JSON.parse(data.response || "{}");
      } catch {
        modelEvaluation = { raw: data.response };
      }

      res.json({
        localEvaluation: local,
        modelEvaluation,
        usedFiles: files
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Evaluation error.",
        details: err.message
      });
    }
  });
}