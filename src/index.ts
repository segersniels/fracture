import * as p from "@clack/prompts";
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

function getFractures(): string[] {
  const repoName = getOriginalRepoName();
  if (!repoName) {
    return [];
  }

  const fracturesPath = join(homedir(), FRACTURE_DIR, repoName);
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

function installDeps(repoRoot: string, worktreePath: string): void {
  const packageJson = join(worktreePath, "package.json");
  if (!existsSync(packageJson)) {
    return;
  }

  const srcNodeModules = join(repoRoot, "node_modules");
  const dstNodeModules = join(worktreePath, "node_modules");

  if (existsSync(srcNodeModules)) {
    console.error("copying node_modules from source...");
    Bun.spawnSync(["cp", "-R", srcNodeModules, dstNodeModules]);
  }

  let cmd: string[];
  let pkgManager: string;

  if (existsSync(join(worktreePath, "pnpm-lock.yaml"))) {
    cmd = ["pnpm", "install"];
    pkgManager = "pnpm";
  } else if (existsSync(join(worktreePath, "yarn.lock"))) {
    cmd = ["yarn", "install"];
    pkgManager = "yarn";
  } else if (existsSync(join(worktreePath, "bun.lockb"))) {
    cmd = ["bun", "install"];
    pkgManager = "bun";
  } else {
    cmd = ["npm", "install"];
    pkgManager = "npm";
  }

  console.error(`installing dependencies with ${pkgManager}...`);
  const result = execInherit(cmd, { cwd: worktreePath });
  if (!result.success) {
    console.error(`warning: failed to install dependencies`);
  }
}

async function create(branch?: string): Promise<void> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    console.error("not in a git repository");
    process.exit(1);
  }

  const repoName = basename(repoRoot);
  const home = homedir();

  let selectedBranch: string;

  if (branch) {
    selectedBranch = branch;
  } else {
    const branches = getBranches(repoRoot);
    if (branches.length === 0) {
      console.error("no branches found");
      process.exit(1);
    }

    const result = await p.select({
      message: "Select branch to checkout",
      options: branches.map((b) => ({ label: b, value: b })),
    });

    if (p.isCancel(result)) {
      process.exit(1);
    }

    selectedBranch = result;
  }

  const fractureId = Date.now().toString();
  const worktreePath = join(home, FRACTURE_DIR, repoName, fractureId);

  let cmd: string[];
  if (branch) {
    cmd = [
      "git",
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      selectedBranch,
    ];
  } else {
    cmd = ["git", "worktree", "add", worktreePath, selectedBranch];
  }

  const result = execInherit(cmd, { cwd: repoRoot });
  if (!result.success) {
    console.error("failed to create worktree");
    process.exit(1);
  }

  installDeps(repoRoot, worktreePath);

  const shell = process.env.SHELL || "/bin/sh";

  console.error(`entering fracture: ${fractureId}`);

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

  const home = homedir();
  const fractures = getFractures();

  for (const id of fractures) {
    const worktreePath = join(home, FRACTURE_DIR, repoName, id);
    const branch = getWorktreeBranch(worktreePath);
    console.log(`${id}  ${branch}`);
  }
}

async function deleteFracture(name?: string): Promise<void> {
  const repoName = getOriginalRepoName();
  if (!repoName) {
    console.error("not in a git repository");
    process.exit(1);
  }

  let selected: string;

  if (name) {
    selected = name;
  } else {
    const fractures = getFractures();
    if (fractures.length === 0) {
      console.error("no fractures found");
      process.exit(1);
    }

    const result = await p.select({
      message: "Select fracture to delete",
      options: fractures.map((f) => ({ label: f, value: f })),
    });

    if (p.isCancel(result)) {
      process.exit(1);
    }

    selected = result;
  }

  const home = homedir();
  const worktreePath = join(home, FRACTURE_DIR, repoName, selected);

  const result = execInherit(["git", "worktree", "remove", worktreePath]);
  if (!result.success) {
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
  .action(async (name?: string) => {
    await deleteFracture(name);
  });

program.parse();
