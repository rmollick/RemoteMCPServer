import fs from "fs";
import path from "path";
import { globSync } from "glob";
import simpleGit from "simple-git";
import { execa } from "execa";

// -----------------------------
// Workspace sandbox
// -----------------------------
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT
  ? path.resolve(process.env.WORKSPACE_ROOT)
  : process.cwd();

// Normalize to real path (helps on Windows / symlinks / OneDrive)
const WORKSPACE_ROOT_REAL = (() => {
  if (fs.existsSync(WORKSPACE_ROOT)) {
    return fs.realpathSync.native(WORKSPACE_ROOT);
  }
  console.warn(`⚠️ Workspace root "${WORKSPACE_ROOT}" does not exist. Falling back to current directory.`);
  return fs.realpathSync.native(process.cwd());
})();

function toPosix(p) {
  return String(p || "").replaceAll("\\", "/");
}

function isWindowsAbs(p) {
  return /^[a-zA-Z]:[\\/]/.test(String(p || ""));
}

function isUNC(p) {
  return /^\\\\/.test(String(p || ""));
}

function safeJoin(relPath) {
  const raw = String(relPath || "");
  const rel = raw.replaceAll("\\", "/");

  // Block absolute Windows paths like C:\foo
  if (isWindowsAbs(rel)) throw new Error("Absolute paths are not allowed");

  // Block UNC paths like \\server\share
  if (isUNC(raw)) throw new Error("UNC paths are not allowed");

  // Block POSIX absolute paths like /etc/passwd
  if (rel.startsWith("/")) throw new Error("Absolute paths are not allowed");

  const abs = path.resolve(WORKSPACE_ROOT_REAL, rel);
  const absReal = fs.existsSync(abs) ? fs.realpathSync.native(abs) : abs;

  // Ensure boundary-safe prefix check (avoid C:\root2 passing C:\root)
  const rootWithSep = WORKSPACE_ROOT_REAL.endsWith(path.sep)
    ? WORKSPACE_ROOT_REAL
    : WORKSPACE_ROOT_REAL + path.sep;

  if (absReal !== WORKSPACE_ROOT_REAL && !absReal.startsWith(rootWithSep)) {
    throw new Error("Path escapes workspace root");
  }

  return absReal;
}

function withinWorkspace(p) {
  try {
    safeJoin(p);
    return true;
  } catch {
    return false;
  }
}

function realIfExists(p) {
  try {
    if (fs.existsSync(p)) return fs.realpathSync.native(p);
  } catch {}
  return p;
}

// -----------------------------
// Git (force it to run in WORKSPACE_ROOT_REAL)
// -----------------------------
const git = simpleGit({ baseDir: WORKSPACE_ROOT_REAL });

// -----------------------------
// Safety: allowlist shell commands (important)
// -----------------------------
const ALLOWED_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "npm test",
  "npm run build",
  "pytest",
  "python -m pytest",
];

function isAllowedCommand(cmd) {
  const normalized = String(cmd || "").trim().toLowerCase();
  return ALLOWED_PREFIXES.some((p) => normalized.startsWith(p));
}

// -----------------------------
// Tool implementations
// -----------------------------
export const toolImpl = {
  fs_readFile: async ({ filePath }) => {
    if (!filePath) throw new Error("filePath is required");
    const abs = safeJoin(filePath);

    // If it doesn't exist, fail clearly
    if (!fs.existsSync(abs)) {
      return {
        ok: false,
        error: "File not found",
        filePath: toPosix(filePath),
        absPath: realIfExists(abs),
        workspaceRoot: WORKSPACE_ROOT_REAL,
      };
    }

    const content = fs.readFileSync(abs, "utf-8");
    return {
      ok: true,
      filePath: toPosix(filePath),
      absPath: realIfExists(abs),
      bytes: Buffer.byteLength(content, "utf-8"),
      content,
      workspaceRoot: WORKSPACE_ROOT_REAL,
    };
  },

  fs_writeFile: async ({ filePath, content }) => {
    if (!filePath) throw new Error("filePath is required");
    if (typeof content !== "string") throw new Error("content must be a string");

    const abs = safeJoin(filePath);

    // Ensure parent dir exists (within workspace)
    const parent = path.dirname(abs);
    fs.mkdirSync(parent, { recursive: true });

    // Write
    fs.writeFileSync(abs, content, "utf-8");

    // VERIFY (this is the critical part)
    const exists = fs.existsSync(abs);
    const absReal = realIfExists(abs);
    const bytes = exists ? fs.statSync(abs).size : 0;

    // Optional read-back sanity (first ~300 chars)
    let preview = "";
    try {
      if (exists) {
        preview = fs.readFileSync(abs, "utf-8").slice(0, 300);
      }
    } catch {}

    // If verification failed, do NOT pretend ok:true
    if (!exists) {
      return {
        ok: false,
        error: "Write failed verification (file not found after write)",
        filePath: toPosix(filePath),
        absPath: absReal,
        workspaceRoot: WORKSPACE_ROOT_REAL,
      };
    }

    return {
      ok: true,
      verified: true,
      filePath: toPosix(filePath),
      absPath: absReal,
      bytes,
      preview,
      workspaceRoot: WORKSPACE_ROOT_REAL,
    };
  },

  fs_mkdir: async ({ dirPath }) => {
    if (!dirPath) throw new Error("dirPath is required");
    const abs = safeJoin(dirPath);
    fs.mkdirSync(abs, { recursive: true });

    const exists = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
    const absReal = realIfExists(abs);

    return {
      ok: exists,
      verified: exists,
      dirPath: toPosix(dirPath),
      absPath: absReal,
      workspaceRoot: WORKSPACE_ROOT_REAL,
    };
  },

  fs_glob: async ({ pattern }) => {
    if (!pattern) throw new Error("pattern is required");

    // Anchor glob to workspace:
    // - run glob with cwd=WORKSPACE_ROOT_REAL
    // - return workspace-relative paths
    // - reject patterns that try to escape
    const pat = String(pattern).replaceAll("\\", "/");

    // Block obvious escapes in glob patterns
    if (pat.includes("..")) {
      return { ok: false, error: "Glob pattern cannot include '..' (escape attempt)", cwd: WORKSPACE_ROOT_REAL };
    }
    if (isWindowsAbs(pat) || pat.startsWith("/") || pat.startsWith("\\\\")) {
      return { ok: false, error: "Glob pattern must be workspace-relative (no absolute/UNC paths)", cwd: WORKSPACE_ROOT_REAL };
    }

    const matches = globSync(pat, {
      cwd: WORKSPACE_ROOT_REAL,
      nodir: true,
      dot: true,
      absolute: false,
    });

    // Defensive filter: ensure each match stays inside workspace when joined
    const safeMatches = matches
      .map((m) => toPosix(m))
      .filter((m) => withinWorkspace(m));

    return { ok: true, cwd: WORKSPACE_ROOT_REAL, matches: safeMatches, count: safeMatches.length };
  },

  git_status: async () => {
    const status = await git.status();
    return { ok: true, baseDir: WORKSPACE_ROOT_REAL, status };
  },

  git_diff: async () => {
    const diff = await git.diff();
    return { ok: true, baseDir: WORKSPACE_ROOT_REAL, diff };
  },

  git_commit: async ({ message }) => {
    if (!message || typeof message !== "string") throw new Error("message is required");
    const result = await git.commit(message);
    return { ok: true, baseDir: WORKSPACE_ROOT_REAL, result };
  },

  shell_run: async ({ cmd, cwd = ".", timeoutMs = 60000 }) => {
    if (!cmd || typeof cmd !== "string") throw new Error("cmd is required");

    if (!isAllowedCommand(cmd)) {
      return {
        ok: false,
        blocked: true,
        reason: "Command not allowlisted",
        cmd,
        allowlistedPrefixes: ALLOWED_PREFIXES,
      };
    }

    // Sandbox cwd to workspace
    const safeCwd = safeJoin(cwd);

    const r = await execa(cmd, {
      cwd: safeCwd,
      shell: true,
      timeout: Number(timeoutMs || 60000),
    });

    return {
      ok: true,
      cmd,
      cwd: toPosix(cwd),
      absCwd: realIfExists(safeCwd),
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
      workspaceRoot: WORKSPACE_ROOT_REAL,
    };
  },
};

// -----------------------------
// Tool declarations (what Gemini sees)
// -----------------------------
export const toolDecl = [
  {
    name: "fs_readFile",
    description:
      "Read a UTF-8 text file from the WORKSPACE_ROOT. filePath must be workspace-relative (no absolute paths).",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Workspace-relative path, e.g. 'StreamingAssets/Scenario/test01.txt'." },
      },
      required: ["filePath"],
    },
  },
  {
    name: "fs_writeFile",
    description:
      "Create or overwrite a UTF-8 text file inside WORKSPACE_ROOT. Creates parent directories if missing. Returns verified=true only if the file exists after write.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Workspace-relative path to write." },
        content: { type: "string", description: "Full new file content." },
      },
      required: ["filePath", "content"],
    },
  },
  {
    name: "fs_glob",
    description:
      "Find files in WORKSPACE_ROOT matching a glob pattern (workspace-relative). Example: 'src/**/*.js' or 'StreamingAssets/Scenario/**/*.txt'.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Workspace-relative glob pattern (no '..' or absolute paths)." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "fs_mkdir",
    description: "Create a directory recursively inside WORKSPACE_ROOT.",
    parameters: {
      type: "object",
      properties: {
        dirPath: { type: "string", description: "Workspace-relative directory path to create." },
      },
      required: ["dirPath"],
    },
  },
  {
    name: "git_status",
    description: "Get git status for the repo under WORKSPACE_ROOT.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "git_diff",
    description: "Get git diff for the repo under WORKSPACE_ROOT.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "git_commit",
    description: "Create a git commit with a message (should be gated/approved).",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    name: "shell_run",
    description:
      "Run an allowlisted shell command inside WORKSPACE_ROOT (cwd is workspace-relative). Blocks non-allowlisted commands.",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Command string (must start with an allowlisted prefix)." },
        cwd: { type: "string", description: "Workspace-relative working directory. Default '.'" },
        timeoutMs: { type: "integer", description: "Timeout in milliseconds." },
      },
      required: ["cmd"],
    },
  },
];
