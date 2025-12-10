import { search, select } from "@inquirer/prompts";
import { program } from "commander";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join } from "path";

const FRACTURE_DIR = ".fracture";

function exec(
  cmd: string[],
  options?: { cwd?: string }
): { stdout: string; success: boolean } {
  const result = Bun.spawnSync(cmd, {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    stdout: result.stdout.toString().trim(),
    success: result.exitCode === 0,
  };
}

function execInherit(
  cmd: string[],
  options?: { cwd?: string }
): { success: boolean } {
  const result = Bun.spawnSync(cmd, {
    cwd: options?.cwd,
    stdout: "inherit",
    stderr: "inherit",
  });

  return { success: result.exitCode === 0 };
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

function getFractures(): string[] {
  const repoName = getOriginalRepoName();
  if (!repoName) {
    return [];
  }

  const fracturesPath = getFracturesDir(repoName);
  if (!existsSync(fracturesPath)) {
    return [];
  }

  return readdirSync(fracturesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function getWorktreeBranch(path: string): string {
  const result = exec(["git", "-C", path, "rev-parse", "--abbrev-ref", "HEAD"]);

  return result.success ? result.stdout : "unknown";
}

function copyEnvFiles(repoRoot: string, worktreePath: string): void {
  const findEnvResult = exec(
    [
      "find",
      ".",
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
      console.error(`copying ${relativePath} from source...`);
      Bun.spawnSync(["cp", src, dst]);
    }
  }
}

const PACKAGE_MANAGERS: Record<string, string[]> = {
  "pnpm-lock.yaml": ["pnpm", "install"],
  "yarn.lock": ["yarn", "install"],
  "bun.lockb": ["bun", "install"],
};

function installNodeDeps(repoRoot: string, worktreePath: string): void {
  const srcNodeModules = join(repoRoot, "node_modules");
  const dstNodeModules = join(worktreePath, "node_modules");

  if (existsSync(srcNodeModules)) {
    console.error("copying node_modules from source...");
    Bun.spawnSync(["cp", "-Rc", srcNodeModules, dstNodeModules]);
  }

  let cmd = ["npm", "install"];
  for (const [lockfile, installCmd] of Object.entries(PACKAGE_MANAGERS)) {
    if (existsSync(join(worktreePath, lockfile))) {
      cmd = installCmd;
      break;
    }
  }

  console.error(`installing dependencies with ${cmd[0]}...`);
  const result = execInherit(cmd, { cwd: worktreePath });
  if (!result.success) {
    console.error("warning: failed to install dependencies");
  }
}

function installRustDeps(worktreePath: string): void {
  console.error("fetching rust dependencies...");
  const result = execInherit(["cargo", "fetch"], { cwd: worktreePath });
  if (!result.success) {
    console.error("warning: failed to fetch rust dependencies");
  }
}

function installGoDeps(worktreePath: string): void {
  console.error("downloading go modules...");
  const result = execInherit(["go", "mod", "download"], { cwd: worktreePath });
  if (!result.success) {
    console.error("warning: failed to download go modules");
  }
}

function installDeps(repoRoot: string, worktreePath: string): void {
  if (existsSync(join(worktreePath, "package.json"))) {
    installNodeDeps(repoRoot, worktreePath);
  } else if (existsSync(join(worktreePath, "Cargo.toml"))) {
    installRustDeps(worktreePath);
  } else if (existsSync(join(worktreePath, "go.mod"))) {
    installGoDeps(worktreePath);
  }
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

  const cmd = newBranch
    ? ["git", "worktree", "add", "-b", newBranch, worktreePath]
    : ["git", "worktree", "add", worktreePath, await selectBranch(repoRoot)];

  const result = execInherit(cmd, { cwd: repoRoot });
  if (!result.success) {
    console.error("failed to create worktree");
    process.exit(1);
  }

  copyEnvFiles(repoRoot, worktreePath);
  installDeps(repoRoot, worktreePath);

  console.error(`entering fracture: ${fractureId}`);

  const shell = process.env.SHELL || "/bin/sh";
  const shellProc = Bun.spawn([shell], {
    cwd: worktreePath,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  await shellProc.exited;

  console.error(`exited fracture: ${fractureId}`);
}

function list(): void {
  const repoName = getOriginalRepoName();
  if (!repoName) {
    console.error("not in a git repository");
    process.exit(1);
  }

  for (const id of getFractures()) {
    const branch = getWorktreeBranch(getFracturePath(repoName, id));
    console.log(`${id} <${branch}>`);
  }
}

function removeWorktree(path: string, force?: boolean): boolean {
  const cmd = ["git", "worktree", "remove", path];
  if (force) {
    cmd.push("--force");
  }

  return execInherit(cmd).success;
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

  const fractures = getFractures();
  if (fractures.length === 0) {
    console.error("no fractures found");
    process.exit(1);
  }

  if (options?.all) {
    for (const id of fractures) {
      const path = getFracturePath(repoName, id);
      if (removeWorktree(path, options.force)) {
        console.error(`deleted ${id}`);
      } else {
        console.error(`failed to delete ${id}`);
      }
    }

    return;
  }

  const selected =
    name ??
    (await select({
      message: "Select fracture to delete",
      choices: fractures.map((id) => {
        const branch = getWorktreeBranch(getFracturePath(repoName, id));
        return { name: `${id} <${branch}>`, value: id };
      }),
    }));

  const path = getFracturePath(repoName, selected);
  if (!removeWorktree(path, options?.force)) {
    console.error("failed to remove worktree");
    process.exit(1);
  }

  console.error(`deleted ${selected}`);
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
  .command("delete [name]")
  .description("Delete a fracture and its associated branch")
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
