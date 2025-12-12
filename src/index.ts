import { search } from "@inquirer/prompts";
import { program } from "commander";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join } from "path";

import { shimmer } from "./utils/shimmer";

const FRACTURE_DIR = ".fracture";

function exec(
  cmd: string[],
  options?: { cwd?: string }
): { stdout: string; stderr: string; success: boolean } {
  const result = Bun.spawnSync(cmd, {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    success: result.exitCode === 0,
  };
}

function getRepoRoot(): string | null {
  const result = exec(["git", "rev-parse", "--show-toplevel"]);
  return result.success ? result.stdout : null;
}

function getOriginalRepoName(): string | null {
  const result = exec(["git", "rev-parse", "--git-common-dir"]);
  if (!result.success) {
    return null;
  }

  const gitDir = result.stdout;

  if (!isAbsolute(gitDir)) {
    const repoRoot = getRepoRoot();
    if (!repoRoot) {
      return null;
    }

    return basename(repoRoot);
  }

  const repoRoot = join(gitDir, "..");

  return basename(repoRoot);
}

function getBranches(repoRoot: string): string[] {
  const result = exec(["git", "branch", "--format=%(refname:short)"], {
    cwd: repoRoot,
  });

  if (!result.success) {
    return [];
  }

  return result.stdout.split("\n").filter((line) => line.length > 0);
}

function getFracturesDir(repoName: string): string {
  return join(homedir(), FRACTURE_DIR, repoName);
}

function getFracturePath(repoName: string, id: string): string {
  return join(getFracturesDir(repoName), id);
}

function getFractures(repoName: string): string[] {
  const fracturesPath = getFracturesDir(repoName);
  if (!existsSync(fracturesPath)) {
    return [];
  }

  return readdirSync(fracturesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function getWorktreesById(repoName: string): Map<string, string> {
  const fracturesPath = getFracturesDir(repoName);
  const result = exec(["git", "worktree", "list", "--porcelain"]);
  const map = new Map<string, string>();
  if (!result.success) {
    return map;
  }

  let currentPath: string | null = null;
  let currentBranch = "unknown";
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (currentPath) {
        const id = currentPath.startsWith(fracturesPath)
          ? currentPath.slice(fracturesPath.length + 1).split("/")[0]
          : null;
        if (id) {
          map.set(id, currentBranch);
        }
      }

      currentPath = line.slice("worktree ".length).trim();
      currentBranch = "unknown";
      continue;
    }

    if (line.startsWith("branch ")) {
      currentBranch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    }
  }

  if (currentPath) {
    const id = currentPath.startsWith(fracturesPath)
      ? currentPath.slice(fracturesPath.length + 1).split("/")[0]
      : null;
    if (id) {
      map.set(id, currentBranch);
    }
  }

  return map;
}

async function copyEnvFiles(
  repoRoot: string,
  worktreePath: string
): Promise<void> {
  const findEnvResult = exec(
    [
      "find",
      ".",
      "-maxdepth",
      "3",
      "-name",
      ".env*",
      "-type",
      "f",
      "-not",
      "-path",
      "*/node_modules/*",
    ],
    { cwd: repoRoot }
  );

  if (findEnvResult.success && findEnvResult.stdout) {
    const envFiles = findEnvResult.stdout
      .split("\n")
      .filter((f) => f.length > 0);
    for (const envFile of envFiles) {
      const relativePath = envFile.replace(/^\.\//, "");
      const src = join(repoRoot, relativePath);
      const dst = join(worktreePath, relativePath);
      const proc = Bun.spawn(["cp", src, dst]);
      await proc.exited;
    }
  }
}

const PACKAGE_MANAGERS: Record<string, string[]> = {
  "pnpm-lock.yaml": ["pnpm", "install"],
  "yarn.lock": ["yarn", "install"],
  "bun.lockb": ["bun", "install"],
  "bun.lock": ["bun", "install"],
};

async function copyNodeModules(
  repoRoot: string,
  worktreePath: string
): Promise<void> {
  const srcNodeModules = join(repoRoot, "node_modules");
  const dstNodeModules = join(worktreePath, "node_modules");

  if (existsSync(srcNodeModules)) {
    const cpArgs =
      process.platform === "darwin"
        ? ["cp", "-Rc", srcNodeModules, dstNodeModules]
        : ["cp", "-R", srcNodeModules, dstNodeModules];

    const proc = Bun.spawn(cpArgs, { stdin: "ignore" });
    await proc.exited;
  }
}

async function installNodeDeps(worktreePath: string): Promise<string | null> {
  let cmd = ["npm", "install"];
  for (const [lockfile, installCmd] of Object.entries(PACKAGE_MANAGERS)) {
    if (existsSync(join(worktreePath, lockfile))) {
      cmd = installCmd;
      break;
    }
  }

  const proc = Bun.spawn(cmd, {
    cwd: worktreePath,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return await new Response(proc.stderr).text();
  }

  return null;
}

async function installRustDeps(worktreePath: string): Promise<string | null> {
  const proc = Bun.spawn(["cargo", "fetch"], {
    cwd: worktreePath,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return await new Response(proc.stderr).text();
  }

  return null;
}

async function installGoDeps(worktreePath: string): Promise<string | null> {
  const proc = Bun.spawn(["go", "mod", "download"], {
    cwd: worktreePath,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return await new Response(proc.stderr).text();
  }

  return null;
}

async function installDeps(
  repoRoot: string,
  worktreePath: string,
  onStatus: (text: string) => void
): Promise<string | null> {
  const isNode = existsSync(join(worktreePath, "package.json"));
  const isRust = existsSync(join(worktreePath, "Cargo.toml"));
  const isGo = existsSync(join(worktreePath, "go.mod"));

  if (!isNode && !isRust && !isGo) {
    return null;
  }

  if (isNode) {
    onStatus("Flibbertigibbeting modules...");
    await copyNodeModules(repoRoot, worktreePath);
  }

  onStatus("Arranging dependencies...");

  if (isNode) {
    return await installNodeDeps(worktreePath);
  } else if (isRust) {
    return await installRustDeps(worktreePath);
  } else if (isGo) {
    return await installGoDeps(worktreePath);
  }

  return null;
}

async function selectBranch(repoRoot: string): Promise<string> {
  const branches = getBranches(repoRoot);
  if (branches.length === 0) {
    console.error("no branches found");
    process.exit(1);
  }

  return search({
    message: "Select branch to checkout",
    source: (input) => {
      const term = input?.toLowerCase() || "";
      return branches
        .filter((b) => b.toLowerCase().includes(term))
        .map((b) => ({ name: b, value: b }));
    },
  });
}

async function create(newBranch?: string): Promise<void> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    console.error("not in a git repository");
    process.exit(1);
  }

  const repoName = basename(repoRoot);
  const fractureId = Date.now().toString();
  const worktreePath = getFracturePath(repoName, fractureId);

  let branch: string;
  if (newBranch) {
    branch = newBranch;
  } else {
    try {
      branch = await selectBranch(repoRoot);
    } catch {
      process.exit(0);
    }
  }

  const status = shimmer("Preparing your fracture...");

  const cmd = newBranch
    ? ["git", "worktree", "add", "-b", newBranch, worktreePath]
    : ["git", "worktree", "add", worktreePath, branch];

  const result = exec(cmd, { cwd: repoRoot });
  if (!result.success) {
    status.stop();
    console.error("failed to create worktree:");
    console.error(result.stderr);
    process.exit(1);
  }
  status.update("Copying environment files...");
  await copyEnvFiles(repoRoot, worktreePath);
  const error = await installDeps(repoRoot, worktreePath, status.update);
  status.stop();

  if (error) {
    console.error("failed to install dependencies:");
    console.error(error);
  }

  console.info("Entered fracture. Type 'exit' to return.");

  const shell = process.env.SHELL || "/bin/sh";
  const shellProc = Bun.spawn([shell], {
    cwd: worktreePath,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  await shellProc.exited;

  console.info("Exited fracture.");
}

async function enter(name?: string): Promise<void> {
  const repoName = getOriginalRepoName();
  if (!repoName) {
    console.error("not in a git repository");
    process.exit(1);
  }

  const fractures = getFractures(repoName);
  if (fractures.length === 0) {
    console.error("no fractures found");
    process.exit(1);
  }

  let selected: string;
  if (name) {
    selected = name;
  } else {
    const worktrees = getWorktreesById(repoName);
    try {
      selected = await search({
        message: "Select fracture to enter",
        source: (input) => {
          const term = input?.toLowerCase() || "";
          return fractures
            .filter((id) => {
              const branch = worktrees.get(id) ?? "unknown";
              return id.includes(term) || branch.toLowerCase().includes(term);
            })
            .map((id) => {
              const branch = worktrees.get(id) ?? "unknown";
              return { name: `${id} <${branch}>`, value: id };
            });
        },
      });
    } catch {
      process.exit(0);
    }
  }

  const worktreePath = getFracturePath(repoName, selected);
  if (!existsSync(worktreePath)) {
    console.error("fracture not found");
    process.exit(1);
  }

  console.info("Entered fracture. Type 'exit' to return.");

  const shell = process.env.SHELL || "/bin/sh";
  const shellProc = Bun.spawn([shell], {
    cwd: worktreePath,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  await shellProc.exited;

  console.info("Exited fracture.");
}

function list(): void {
  const repoName = getOriginalRepoName();
  if (!repoName) {
    console.error("not in a git repository");
    process.exit(1);
  }

  const worktrees = getWorktreesById(repoName);
  for (const id of getFractures(repoName)) {
    const branch = worktrees.get(id) ?? "unknown";
    console.log(`${id} <${branch}>`);
  }
}

async function removeWorktree(path: string, force?: boolean): Promise<boolean> {
  const cmd = ["git", "worktree", "remove", path];
  if (force) {
    cmd.push("--force");
  }

  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  const exitCode = await proc.exited;

  return exitCode === 0;
}

async function deleteFracture(
  name?: string,
  options?: { force?: boolean; all?: boolean }
): Promise<void> {
  const repoName = getOriginalRepoName();
  if (!repoName) {
    console.error("not in a git repository");
    process.exit(1);
  }

  const fractures = getFractures(repoName);
  if (fractures.length === 0) {
    console.error("no fractures found");
    process.exit(1);
  }

  if (options?.all) {
    const status = shimmer("Deleting all fractures...");
    for (const id of fractures) {
      const path = getFracturePath(repoName, id);
      if (!(await removeWorktree(path, options.force))) {
        status.stop();
        console.error(`failed to delete ${id}`);
      }
    }
    status.stop();

    return;
  }

  let selected: string;
  if (name) {
    selected = name;
  } else {
    const worktrees = getWorktreesById(repoName);
    try {
      selected = await search({
        message: "Select fracture to delete",
        source: (input) => {
          const term = input?.toLowerCase() || "";
          return fractures
            .filter((id) => {
              const branch = worktrees.get(id) ?? "unknown";
              return id.includes(term) || branch.toLowerCase().includes(term);
            })
            .map((id) => {
              const branch = worktrees.get(id) ?? "unknown";
              return { name: `${id} <${branch}>`, value: id };
            });
        },
      });
    } catch {
      process.exit(0);
    }
  }

  const path = getFracturePath(repoName, selected);
  const status = shimmer("Deleting fracture...");
  const success = await removeWorktree(path, options?.force);
  status.stop();

  if (!success) {
    console.error("failed to remove worktree");
    process.exit(1);
  }

  console.info(`deleted ${selected}`);
}

program
  .name("fracture")
  .description(
    "Quickly create git worktrees to work on multiple branches simultaneously"
  )
  .option("-b, --branch <name>", "create a new branch with this name")
  .action(async (options) => {
    await create(options.branch);
  });

program
  .command("list")
  .alias("ls")
  .description("List all fractures for the current repository")
  .action(() => {
    list();
  });

program
  .command("enter [name]")
  .description("Enter an existing fracture")
  .action(async (name: string | undefined) => {
    await enter(name);
  });

program
  .command("delete [name]")
  .description("Delete a fracture")
  .option("-f, --force", "force delete even with uncommitted changes")
  .option("-a, --all", "delete all fractures")
  .action(
    async (
      name: string | undefined,
      options: { force?: boolean; all?: boolean }
    ) => {
      await deleteFracture(name, options);
    }
  );

program.parse();
