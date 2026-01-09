import { existsSync, readFileSync } from "fs";
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

const NODE_VERSION_FILES = [".nvmrc", ".node-version", ".tool-versions"] as const;

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
    return `${this.id} <${this.branch}>`;
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
    const cmd = ["git", "worktree", "remove", this.path];
    if (force) {
      cmd.push("--force");
    }

    const result = await exec(cmd);

    return result.success ? null : result.stderr || "unknown error";
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
    const isNode = existsSync(join(this.path, "package.json"));
    const isRust = existsSync(join(this.path, "Cargo.toml"));
    const isGo = existsSync(join(this.path, "go.mod"));

    if (!isNode && !isRust && !isGo) {
      return null;
    }

    status.update("Flibbertigibbeting dependencies…");

    if (isNode) {
      return this.installNodeDeps();
    }

    if (isRust) {
      return this.installRustDeps();
    }

    if (isGo) {
      return this.installGoDeps();
    }

    return null;
  }

  private async installNodeDeps() {
    let cmd = ["npm", "install"];
    for (const [lockfile, installCmd] of Object.entries(PACKAGE_MANAGERS)) {
      if (existsSync(join(this.path, lockfile))) {
        cmd = installCmd;
        break;
      }
    }

    const installCmd = this.buildNodeInstallCommand(cmd);
    const proc = Bun.spawn(installCmd, {
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

  private async installRustDeps() {
    const proc = Bun.spawn(["cargo", "fetch"], {
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

  private async installGoDeps() {
    const proc = Bun.spawn(["go", "mod", "download"], {
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
}
