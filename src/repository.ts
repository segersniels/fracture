import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join } from "path";

import Fracture from "./fracture";
import { exec } from "./utils/exec";

const FRACTURE_DIR = ".fracture";

export default class Repository {
  public readonly name: string;
  public readonly root: string;

  private constructor(name: string, root: string) {
    this.name = name;
    this.root = root;
  }

  public static async detect() {
    const rootResult = await exec(["git", "rev-parse", "--show-toplevel"]);
    if (!rootResult.success) {
      return null;
    }

    const root = rootResult.stdout;
    const gitDirResult = await exec(["git", "rev-parse", "--git-common-dir"]);
    if (!gitDirResult.success) {
      return null;
    }

    const gitDir = gitDirResult.stdout;
    let name: string;

    if (isAbsolute(gitDir)) {
      name = basename(join(gitDir, ".."));
    } else {
      name = basename(root);
    }

    return new Repository(name, root);
  }

  public get fracturesDir() {
    return join(homedir(), FRACTURE_DIR, this.name);
  }

  public async getBranches() {
    const result = await exec(["git", "branch", "--format=%(refname:short)"], {
      cwd: this.root,
    });

    if (!result.success) {
      return [];
    }

    return result.stdout.split("\n").filter((line) => line.length > 0);
  }

  public async getFractures() {
    if (!existsSync(this.fracturesDir)) {
      return [];
    }

    const worktrees = await this.getWorktreesById();

    return readdirSync(this.fracturesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const id = entry.name;
        const path = join(this.fracturesDir, id);
        const branch = worktrees.get(id) ?? "unknown";

        return new Fracture(id, path, branch, this);
      });
  }

  private async getWorktreesById() {
    const result = await exec(["git", "worktree", "list", "--porcelain"]);
    const map = new Map<string, string>();
    if (!result.success) {
      return map;
    }

    let currentPath: string | null = null;
    let currentBranch = "unknown";

    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (currentPath) {
          const id = currentPath.startsWith(this.fracturesDir)
            ? currentPath.slice(this.fracturesDir.length + 1).split("/")[0]
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
      const id = currentPath.startsWith(this.fracturesDir)
        ? currentPath.slice(this.fracturesDir.length + 1).split("/")[0]
        : null;
      if (id) {
        map.set(id, currentBranch);
      }
    }

    return map;
  }

  public async createFracture(branch: string, isNewBranch = false) {
    const id = Date.now().toString();
    const path = join(this.fracturesDir, id);

    const cmd = isNewBranch
      ? ["git", "worktree", "add", "-b", branch, path]
      : ["git", "worktree", "add", path, branch];

    const result = await exec(cmd, { cwd: this.root });
    if (!result.success) {
      throw new Error(result.stderr);
    }

    return new Fracture(id, path, branch, this);
  }
}
