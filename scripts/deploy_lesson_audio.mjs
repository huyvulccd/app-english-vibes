// Create and publish the six small audio-only GitHub Pages repositories.
// Usage: node scripts/deploy_lesson_audio.mjs --execute
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staging = path.join(root, "SOURCE", "audio-sites");
const owner = "huyvulccd";
const slugs = ["beginner", "elementary", "pre-intermediate", "intermediate", "upper-intermediate", "advanced"];
const levels = ["1.BEGINNER", "2.ELEMENTARY", "3.PRE-INTERMEDIATE", "4.INTERMEDIATE", "5.UPPER-INTERMEDIATE", "6.ADVANCED"];
const execute = process.argv.includes("--execute");

function git(directory, args) {
  const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 4 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed in ${directory}: ${(result.stderr || result.stdout).slice(-800)}`);
  return result.stdout.trim();
}

function githubCredential() {
  const output = execFileSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" });
  const token = output.split(/\r?\n/).find((line) => line.startsWith("password="))?.slice(9);
  if (!token) throw new Error("GitHub credential was not found in Git Credential Manager.");
  return token;
}

async function api(token, method, route, body) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(`https://api.github.com${route}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "sayback-course-deploy",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 404) return { status: 404, data: null };
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new Error(`GitHub API ${method} ${route}: HTTP ${response.status} ${data?.message || ""}`);
      return { status: response.status, data };
    } catch (error) {
      if (attempt === 5 || (error.message.includes("HTTP ") && !/HTTP (429|500|502|503|504)/.test(error.message))) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
}

async function listAudioFiles(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".mp3"));
  let bytes = 0;
  for (const name of names) {
    const file = await stat(path.join(directory, name));
    if (file.size > 100_000_000) throw new Error(`File exceeds regular Git limit: ${name}`);
    bytes += file.size;
  }
  if (bytes > 950_000_000) throw new Error(`Site exceeds planned size: ${directory}`);
  return { count: names.length, bytes };
}

async function main() {
  const plans = [];
  for (let index = 0; index < slugs.length; index++) {
    const repo = `app-english-vibes-audio-${slugs[index]}`;
    const directory = path.join(staging, repo);
    const audio = await listAudioFiles(path.join(directory, "audio"));
    plans.push({ repo, level: levels[index], directory, ...audio });
  }
  for (const plan of plans) console.log(`${plan.repo}: ${plan.count} files, ${(plan.bytes / 1024 / 1024).toFixed(1)} MiB`);
  if (!execute) {
    console.log("Dry run complete. Pass --execute to create repositories and publish audio.");
    return;
  }

  const token = githubCredential();
  const user = (await api(token, "GET", "/user")).data;
  if (user.login.toLowerCase() !== owner) throw new Error(`Authenticated as ${user.login}, expected ${owner}.`);
  console.log(`Authenticated as ${user.login}`);

  const sources = {};
  for (const plan of plans) {
    const route = `/repos/${owner}/${plan.repo}`;
    const existing = await api(token, "GET", route);
    const description = `SayBack audio for New English File ${plan.level}`;
    if (existing.status === 404) {
      await api(token, "POST", "/user/repos", { name: plan.repo, description, private: false, has_issues: false, has_wiki: false, auto_init: false });
      console.log(`Created ${plan.repo}`);
    } else if (existing.data.owner.login.toLowerCase() !== owner || existing.data.description !== description) {
      throw new Error(`Existing repository ${plan.repo} does not match this deployment.`);
    }

    if (!existsSync(path.join(plan.directory, ".git"))) git(plan.directory, ["init", "-b", "main"]);
    git(plan.directory, ["add", "-A"]);
    const changes = git(plan.directory, ["status", "--porcelain"]);
    if (changes) {
      git(plan.directory, ["commit", "-m", "Publish SayBack lesson audio"]);
      console.log(`Committed ${plan.repo}`);
    }
    const remote = `https://github.com/${owner}/${plan.repo}.git`;
    let hasOrigin = false;
    try { hasOrigin = Boolean(git(plan.directory, ["remote", "get-url", "origin"])); } catch { /* new repository */ }
    git(plan.directory, hasOrigin ? ["remote", "set-url", "origin", remote] : ["remote", "add", "origin", remote]);
    git(plan.directory, ["push", "-u", "origin", "main"]);
    console.log(`Pushed ${plan.repo}`);

    const pages = await api(token, "GET", `${route}/pages`);
    if (pages.status === 404) {
      await api(token, "POST", `${route}/pages`, { source: { branch: "main", path: "/" } });
      console.log(`Enabled Pages for ${plan.repo}`);
    }
    sources[plan.level] = `https://${owner}.github.io/${plan.repo}`;
  }
  await writeFile(path.join(root, "lesson-audio-sources.json"), `${JSON.stringify({ levels: sources })}\n`, "utf8");
  console.log("Wrote lesson-audio-sources.json");
}

await main();
