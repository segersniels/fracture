import { existsSync } from "fs";
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
    if (isNode) {
      status.update("Flibbertigibbeting modules…");
      await this.copyNodeModules();
    }

    status.update("Arranging dependencies…");

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

  private async copyNodeModules() {
    const src = join(this.repository.root, "node_modules");
    const dst = join(this.path, "node_modules");

    if (!existsSync(src)) {
      return;
    }

    const cpArgs =
      process.platform === "darwin"
        ? ["cp", "-Rc", src, dst]
        : ["cp", "-R", src, dst];

    const proc = Bun.spawn(cpArgs, { stdin: "ignore" });
    await proc.exited;
  }

  private async installNodeDeps() {
    let cmd = ["npm", "install"];
    for (const [lockfile, installCmd] of Object.entries(PACKAGE_MANAGERS)) {
      if (existsSync(join(this.path, lockfile))) {
        cmd = installCmd;
        break;
      }
    }

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
