// import fs from "fs";
// import path from "path";
// import { globSync } from "glob";
// import simpleGit from "simple-git";
// import { execa } from "execa";

// const git = simpleGit();

// // --- Safety: allowlist shell commands (very important) ---
// const ALLOWED_PREFIXES = [
//   "git status",
//   "git diff",
//   "npm test",
//   "npm run build",
//   "pytest",
//   "python -m pytest",
// ];

// function isAllowedCommand(cmd) {
//   const normalized = cmd.trim().toLowerCase();
//   return ALLOWED_PREFIXES.some((p) => normalized.startsWith(p));
// }

// // --- Tool implementations ---
// export const toolImpl = {
//   fs_readFile: async ({ filePath }) => {
//     const abs = path.resolve(filePath);
//     const content = fs.readFileSync(abs, "utf-8");
//     return { ok: true, filePath: abs, content };
//   },

//   fs_writeFile: async ({ filePath, content }) => {
//     const abs = path.resolve(filePath);
//     fs.mkdirSync(path.dirname(abs), { recursive: true });
//     fs.writeFileSync(abs, content, "utf-8");
//     return { ok: true, filePath: abs };
//   },

//   fs_glob: async ({ pattern }) => {
//     const matches = globSync(pattern, { nodir: true });
//     return { ok: true, matches };
//   },

//   fs_mkdir: async ({ dirPath }) => {
//     const abs = path.resolve(dirPath);
//     fs.mkdirSync(abs, { recursive: true });
//     return { ok: true, dirPath: abs };
//   },

//   git_status: async () => {
//     const status = await git.status();
//     return { ok: true, status };
//   },

//   git_diff: async () => {
//     const diff = await git.diff();
//     return { ok: true, diff };
//   },

//   git_commit: async ({ message }) => {
//     // keep gated later; for now it works but you should require approval
//     const result = await git.commit(message);
//     return { ok: true, result };
//   },

//   shell_run: async ({ cmd, cwd = ".", timeoutMs = 60000 }) => {
//     if (!isAllowedCommand(cmd)) {
//       return {
//         ok: false,
//         blocked: true,
//         reason: "Command not allowlisted",
//         cmd,
//       };
//     }

//     const r = await execa(cmd, {
//       cwd,
//       shell: true,
//       timeout: timeoutMs,
//     });

//     return { ok: true, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
//   },
// };

// // --- Tool declarations (what Gemini sees) ---
// export const toolDecl = [
//   {
//     name: "fs_readFile",
//     description: "Read a UTF-8 text file from the workspace.",
//     parameters: {
//       type: "object",
//       properties: {
//         filePath: { type: "string", description: "Path to file (relative or absolute)." },
//       },
//       required: ["filePath"],
//     },
//   },
//   {
//     name: "fs_writeFile",
//     description: "Write a UTF-8 text file. Creates parent directories if missing.",
//     parameters: {
//       type: "object",
//       properties: {
//         filePath: { type: "string" },
//         content: { type: "string" },
//       },
//       required: ["filePath", "content"],
//     },
//   },
//   {
//     name: "fs_glob",
//     description: "Find files matching a glob pattern (e.g., **/*.js).",
//     parameters: {
//       type: "object",
//       properties: {
//         pattern: { type: "string" },
//       },
//       required: ["pattern"],
//     },
//   },
//   {
//     name: "fs_mkdir",
//     description: "Create a directory recursively.",
//     parameters: {
//       type: "object",
//       properties: {
//         dirPath: { type: "string" },
//       },
//       required: ["dirPath"],
//     },
//   },
//   {
//     name: "git_status",
//     description: "Get git status for the current repo.",
//     parameters: { type: "object", properties: {} },
//   },
//   {
//     name: "git_diff",
//     description: "Get git diff for the current repo.",
//     parameters: { type: "object", properties: {} },
//   },
//   {
//     name: "git_commit",
//     description: "Create a git commit with a message (should be gated/approved).",
//     parameters: {
//       type: "object",
//       properties: {
//         message: { type: "string" },
//       },
//       required: ["message"],
//     },
//   },
//   {
//     name: "shell_run",
//     description: "Run an allowlisted shell command in a working directory.",
//     parameters: {
//       type: "object",
//       properties: {
//         cmd: { type: "string" },
//         cwd: { type: "string" },
//         timeoutMs: { type: "integer" },
//       },
//       required: ["cmd"],
//     },
//   },
// ];
