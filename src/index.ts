import { search } from "@inquirer/prompts";
import { program } from "commander";

import Fracture from "./fracture";
import Repository from "./repository";
import Shimmer from "./utils/shimmer";

async function requireRepo() {
  const repo = await Repository.detect();
  if (!repo) {
    console.error("not in a git repository");
    process.exit(1);
  }

  return repo;
}

async function requireFractures(repo: Repository) {
  const fractures = await repo.getFractures();
  if (!fractures.length) {
    console.error("no fractures found");
    process.exit(1);
  }

  return fractures;
}

async function selectBranch(repo: Repository) {
  const branches = await repo.getBranches();
  if (!branches.length) {
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

async function selectFracture(fractures: Fracture[], message: string) {
  return search({
    message,
    source: (input) => {
      const term = input?.toLowerCase() || "";

      return fractures
        .filter(
          (f) => f.id.includes(term) || f.branch.toLowerCase().includes(term)
        )
        .map((f) => ({ name: f.displayName, value: f }));
    },
  });
}

async function create(newBranch?: string) {
  const repo = await requireRepo();

  let branch: string;
  if (newBranch) {
    branch = newBranch;
  } else {
    try {
      branch = await selectBranch(repo);
    } catch {
      process.exit(0);
    }
  }

  using status = new Shimmer();
  status.update("Preparing your fracture…");

  let fracture: Fracture;
  try {
    fracture = await repo.createFracture(branch, !!newBranch);
  } catch (err) {
    console.error("failed to create worktree:");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  status.update("Copying environment files…");
  await fracture.copyEnvFiles();

  const error = await fracture.installDeps(status);
  status.stop();

  if (error) {
    console.error("failed to install dependencies:");
    console.error(error);
  }

  await fracture.enter();
}

async function enter(name?: string) {
  const repo = await requireRepo();
  const fractures = await requireFractures(repo);

  let fracture: Fracture;
  if (name) {
    const found = fractures.find((f) => f.id === name);
    if (!found) {
      console.error("fracture not found");
      process.exit(1);
    }
    fracture = found;
  } else {
    try {
      fracture = await selectFracture(fractures, "Select fracture to enter");
    } catch {
      process.exit(0);
    }
  }

  await fracture.enter();
}

async function list() {
  const repo = await requireRepo();
  const fractures = await repo.getFractures();

  for (const fracture of fractures) {
    console.log(fracture.displayName);
  }
}

async function deleteFracture(
  name?: string,
  options?: { force?: boolean; all?: boolean }
) {
  using status = new Shimmer();
  const repo = await requireRepo();
  const fractures = await requireFractures(repo);

  if (options?.all) {
    status.update("Deleting all fractures…");

    // Gather errors and print after stopping shimmer to avoid overwriting the status line
    const errors: string[] = [];
    for (const fracture of fractures) {
      const error = await fracture.delete(options.force);
      if (error) {
        errors.push(`failed to delete ${fracture.id}: ${error}`);
      }
    }
    status.stop();

    for (const error of errors) {
      console.error(error);
    }

    return;
  }

  let fracture: Fracture;
  if (name) {
    const found = fractures.find((f) => f.id === name);
    if (!found) {
      console.error("fracture not found");
      process.exit(1);
    }
    fracture = found;
  } else {
    try {
      fracture = await selectFracture(fractures, "Select fracture to delete");
    } catch {
      process.exit(0);
    }
  }

  status.update("Deleting fracture…");
  const error = await fracture.delete(options?.force);
  status.stop();

  if (error) {
    console.error(`failed to delete: ${error}`);
    process.exit(1);
  }

  console.info(`deleted ${fracture.id}`);
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
  .action(async () => {
    await list();
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
