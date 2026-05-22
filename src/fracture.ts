import { existsSync, readFileSync } from "fs";
import { mkdir, rename } from "fs/promises";
import { join } from "path";

import type Repository from "./repository";
import { exec } from "./utils/exec";
import type Shimmer from "./utils/shimmer";

const PACKAGE_MANAGERS: Record<string, string[]> = {
  "pnpm-lock.yaml": ["pnpm", "install"],
  "yarn.lock": ["yarn", "install"],
  "bun.lockb": ["bun", "install"],
  "bun.lock": ["bun", "install"],
};

const NODE_VERSION_FILES = [
  ".nvmrc",
  ".node-version",
  ".tool-versions",
] as const;

type NodeVersionManager = "fnm" | "nvm" | "n";

export default class Fracture {
  public readonly id: string;
  public readonly path: string;
  public readonly branch: string;
  public readonly repository: Repository;

  public constructor(
    id: string,
    path: string,
    branch: string,
    repository: Repository
  ) {
    this.id = id;
    this.path = path;
    this.branch = branch;
    this.repository = repository;
  }

  public get displayName() {
    if (this.branch === "unknown") {
      return this.id;
    }

    return this.branch;
  }

  public async enter() {
    if (!existsSync(this.path)) {
      throw new Error("fracture not found");
    }

    console.info("Entered fracture. Type 'exit' to return.");

    const shell = process.env.SHELL || "/bin/sh";
    const proc = Bun.spawn([shell], {
      cwd: this.path,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    await proc.exited;

    console.info("Exited fracture.");
  }

  public async delete(force = false) {
    const preflightError = await this.prepareDelete(force);
    if (preflightError) {
      return preflightError;
    }

    const moved = await this.moveToTrash();
    if ("error" in moved) {
      return moved.error;
    }

    const worktreeError = await this.removeWorktree(force);
    if (worktreeError) {
      return worktreeError;
    }

    return this.repository.clearTrash();
  }

  public async prepareDelete(force = false) {
    const lockedError = await this.getLockedError();
    if (lockedError) {
      return lockedError;
    }

    if (force) {
      return null;
    }

    const result = await exec(["git", "status", "--porcelain"], {
      cwd: this.path,
    });
    if (!result.success) {
      return result.stderr || "failed to inspect worktree";
    }

    if (result.stdout) {
      return "contains modified or untracked files, use --force to delete it";
    }

    return null;
  }

  public async moveToTrash() {
    const trashPath = join(
      this.repository.trashDir,
      `${this.id}-${process.pid}-${Date.now()}`
    );

    try {
      await mkdir(this.repository.trashDir, { recursive: true });
      await rename(this.path, trashPath);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }

    return { trashPath };
  }

  public async removeWorktree(force = false) {
    const cmd = ["git", "worktree", "remove", this.path];
    if (force) {
      cmd.push("--force");
    }

    const result = await exec(cmd, { cwd: this.repository.root });

    return result.success ? null : result.stderr || "unknown error";
  }

  private async getLockedError() {
    const result = await exec(["git", "worktree", "list", "--porcelain"], {
      cwd: this.repository.root,
    });
    if (!result.success) {
      return result.stderr || "failed to inspect worktrees";
    }

    let isCurrentWorktree = false;
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        isCurrentWorktree = line.slice("worktree ".length).trim() === this.path;
        continue;
      }

      if (!isCurrentWorktree || !line.startsWith("locked")) {
        continue;
      }

      const reason = line.slice("locked".length).trim();
      return reason
        ? `cannot remove a locked worktree: ${reason}`
        : "cannot remove a locked worktree";
    }

    return null;
  }

  public async copyEnvFiles() {
    const result = Bun.spawnSync(
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
      { cwd: this.repository.root, stdout: "pipe", stderr: "pipe" }
    );

    const stdout = result.stdout.toString().trim();
    if (result.exitCode !== 0 || !stdout) {
      return;
    }

    const envFiles = stdout.split("\n").filter((f) => f.length > 0);
    for (const envFile of envFiles) {
      const relativePath = envFile.replace(/^\.\//, "");
      const src = join(this.repository.root, relativePath);
      const dst = join(this.path, relativePath);
      const proc = Bun.spawn(["cp", src, dst]);
      await proc.exited;
    }
  }

  public async installDeps(status: Shimmer) {
    const cmd = this.getInstallCommand();
    if (!cmd) {
      return null;
    }

    status.update("Flibbertigibbeting dependencies…");

    return this.runInstallCommand(cmd);
  }

  public startInstallDeps() {
    const cmd = this.getInstallCommand();
    if (!cmd) {
      return null;
    }

    const proc = Bun.spawn(cmd, {
      cwd: this.path,
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    proc.unref();

    return { pid: proc.pid };
  }

  private getInstallCommand() {
    if (existsSync(join(this.path, "package.json"))) {
      return this.getNodeInstallCommand();
    }

    if (existsSync(join(this.path, "Cargo.toml"))) {
      return ["cargo", "fetch"];
    }

    if (existsSync(join(this.path, "go.mod"))) {
      return ["go", "mod", "download"];
    }

    return null;
  }

  private getNodeInstallCommand() {
    let cmd = ["npm", "install"];
    for (const [lockfile, installCmd] of Object.entries(PACKAGE_MANAGERS)) {
      if (existsSync(join(this.path, lockfile))) {
        cmd = installCmd;
        break;
      }
    }

    return this.buildNodeInstallCommand(cmd);
  }

  private async runInstallCommand(cmd: string[]) {
    const proc = Bun.spawn(cmd, {
      cwd: this.path,
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

  private buildNodeInstallCommand(cmd: string[]) {
    const version = this.readNodeVersion();
    if (!version) {
      return cmd;
    }

    const manager = this.detectNodeVersionManager();
    if (!manager) {
      return cmd;
    }

    if (manager === "fnm") {
      return ["fnm", "exec", "--using", version, "--", ...cmd];
    }

    if (manager === "n") {
      return ["n", "exec", version, ...cmd];
    }

    const nvm = this.buildNvmCommand(version, cmd);
    return nvm ?? cmd;
  }

  private readNodeVersion() {
    for (const filename of NODE_VERSION_FILES) {
      const fullPath = join(this.path, filename);
      if (!existsSync(fullPath)) {
        continue;
      }

      const raw = readFileSync(fullPath, "utf8").trim();
      if (!raw) {
        continue;
      }

      if (filename === ".tool-versions") {
        const line = raw
          .split(/\r?\n/)
          .find((entry) => entry.trim().startsWith("nodejs "));
        if (!line) {
          continue;
        }
        const [, version] = line.trim().split(/\s+/);
        if (version) {
          return version;
        }
        continue;
      }

      return raw;
    }

    return null;
  }

  private detectNodeVersionManager(): NodeVersionManager | null {
    if (Bun.which("fnm")) {
      return "fnm";
    }

    if (this.hasNvm()) {
      return "nvm";
    }

    if (Bun.which("n")) {
      return "n";
    }

    return null;
  }

  private hasNvm() {
    const nvmDir =
      process.env.NVM_DIR ||
      (process.env.HOME ? join(process.env.HOME, ".nvm") : null);
    if (!nvmDir) {
      return false;
    }

    return existsSync(join(nvmDir, "nvm.sh"));
  }

  private buildNvmCommand(version: string, cmd: string[]) {
    const nvmDir =
      process.env.NVM_DIR ||
      (process.env.HOME ? join(process.env.HOME, ".nvm") : null);
    if (!nvmDir) {
      return null;
    }

    const nvmScript = join(nvmDir, "nvm.sh");
    if (!existsSync(nvmScript)) {
      return null;
    }

    const shell = existsSync("/bin/bash")
      ? "/bin/bash"
      : process.env.SHELL || "/bin/sh";
    const command = [
      `. ${this.escapeShellArg(nvmScript)}`,
      `nvm exec ${this.escapeShellArg(version)} ${cmd
        .map((part) => this.escapeShellArg(part))
        .join(" ")}`,
    ].join(" && ");

    return [shell, "-lc", command];
  }

  private escapeShellArg(value: string) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
}
