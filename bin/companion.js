#!/usr/bin/env node

/**
 * DevShelf Menu-Bar & Desktop Companion Launcher
 *
 * Lightweight offline companion widget for instant tool lookup,
 * status checks, and local/remote Web Playground launching.
 *
 * Usage:
 *   npx devshelf companion              # Interactive companion quick launcher
 *   npx devshelf companion --playground # Open Interactive Web Playground
 *   npx devshelf companion "postgres"   # Quick search in companion view
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { getResourceUrl, loadCatalog, searchCatalog } from "./lib/catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const useColor = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const c = {
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  dim: useColor ? "\x1b[2m" : "",
  underline: useColor ? "\x1b[4m" : "",
  purple: useColor ? "\x1b[38;2;168;85;247m" : "",
  cyan: useColor ? "\x1b[38;2;6;182;212m" : "",
  blue: useColor ? "\x1b[38;2;59;130;246m" : "",
  green: useColor ? "\x1b[38;2;34;197;94m" : "",
  amber: useColor ? "\x1b[38;2;245;158;11m" : "",
  red: useColor ? "\x1b[38;2;239;68;68m" : "",
  gray: useColor ? "\x1b[38;2;148;163;184m" : "",
  white: useColor ? "\x1b[97m" : "",
};

export function openUrl(url) {
  if (!url || typeof url !== "string") return;

  let parsed;
  try {
    parsed = new URL(url);
    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:" &&
      parsed.protocol !== "file:"
    ) {
      return;
    }
  } catch {
    return;
  }

  const safeUrl = parsed.href;

  if (process.platform === "win32") {
    const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", safeUrl], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }

  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(opener, [safeUrl], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function openPlayground() {
  const localPlayground = path.resolve(__dirname, "..", "site", "playground.html");
  if (fs.existsSync(localPlayground)) {
    const fileUrl = new URL(`file://${path.resolve(localPlayground).replace(/\\/g, "/")}`).href;
    console.log(`  🚀 Opening local DevShelf Web Playground: ${c.cyan}${fileUrl}${c.reset}`);
    openUrl(fileUrl);
    return;
  }

  const hostedUrl = "https://devshelf.ritualdev.in/playground.html";
  console.log(`  🚀 Opening hosted DevShelf Web Playground: ${c.cyan}${hostedUrl}${c.reset}`);
  openUrl(hostedUrl);
}

export function openStatus() {
  const localStatus = path.resolve(__dirname, "..", "site", "status.html");
  if (fs.existsSync(localStatus)) {
    const fileUrl = new URL(`file://${path.resolve(localStatus).replace(/\\/g, "/")}`).href;
    console.log(`  📊 Opening DevShelf Uptime & Status Dashboard: ${c.cyan}${fileUrl}${c.reset}`);
    openUrl(fileUrl);
    return;
  }

  const hostedUrl = "https://devshelf.ritualdev.in/status.html";
  console.log(`  📊 Opening hosted DevShelf Status Dashboard: ${c.cyan}${hostedUrl}${c.reset}`);
  openUrl(hostedUrl);
}

function printCompanionHeader(count) {
  console.log(`
${c.purple}${c.bold}  ╭──────────────────────────────────────────────────────────╮${c.reset}
${c.purple}${c.bold}  │  ⚡ DevShelf Menu-Bar Companion                           │${c.reset}
${c.cyan}  │  ${count} Verified Zero-Paywall Tools • Offline Quick Access  │${c.reset}
${c.purple}${c.bold}  ╰──────────────────────────────────────────────────────────╯${c.reset}`);
}

export async function startCompanion(initialArgs = []) {
  const args = initialArgs.length > 0 ? initialArgs : process.argv.slice(2);

  if (args.includes("--playground") || args.includes("playground") || args.includes("-p")) {
    openPlayground();
    return;
  }

  if (args.includes("--status") || args.includes("status")) {
    openStatus();
    return;
  }

  const catalog = await loadCatalog({ preferLocal: true });
  const resources = catalog.resources || [];
  const totalCount = resources.length || 567;

  // Single-query quick mode: if an argument is passed (e.g. `npx devshelf companion postgres`)
  const queryArg = args.find((a) => !a.startsWith("-") && a !== "companion");
  if (queryArg) {
    const results = searchCatalog(resources, queryArg).slice(0, 8);
    printCompanionHeader(totalCount);
    console.log(
      `\n  🔍 Quick match for "${c.bold}${queryArg}${c.reset}" (${results.length} found):\n`,
    );
    results.forEach((item, idx) => {
      const url = getResourceUrl(item);
      const free = item.freeTier ? ` ${c.green}[${item.freeTier}]${c.reset}` : "";
      console.log(`  ${c.purple}[${idx + 1}]${c.reset} ${c.bold}${item.name}${c.reset}${free}`);
      console.log(`      ${c.gray}${item.description || ""}${c.reset}`);
      console.log(`      ${c.blue}${c.underline}${url}${c.reset}\n`);
    });
    return;
  }

  // Interactive companion loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  while (true) {
    console.clear();
    printCompanionHeader(totalCount);
    console.log(`
  ${c.bold}Quick Commands:${c.reset}
    ${c.cyan}[p]${c.reset} 🧪 Launch Interactive Web Playground
    ${c.cyan}[s]${c.reset} 📊 Open Healthcheck Uptime & Badges Dashboard
    ${c.cyan}[r]${c.reset} 🎲 Surprise Me (Random Tool)
    ${c.cyan}[q]${c.reset} 🚪 Quit Companion

  ${c.dim}Or type any search keyword (e.g. postgres, auth, mcp, agents, mock, test):${c.reset}
`);

    const input = (await question(`  ${c.green}Companion ❯${c.reset} `)).trim();

    if (!input || input.toLowerCase() === "q" || input.toLowerCase() === "exit") {
      console.log(`\n  ${c.purple}DevShelf Companion closed. Happy building! ⚡${c.reset}\n`);
      rl.close();
      break;
    }

    if (input.toLowerCase() === "p" || input.toLowerCase() === "playground") {
      openPlayground();
      await question(`\n  ${c.gray}Press Enter to return to companion...${c.reset}`);
      continue;
    }

    if (input.toLowerCase() === "s" || input.toLowerCase() === "status") {
      openStatus();
      await question(`\n  ${c.gray}Press Enter to return to companion...${c.reset}`);
      continue;
    }

    if (input.toLowerCase() === "r" || input.toLowerCase() === "random") {
      const randomItem = resources[Math.floor(Math.random() * resources.length)];
      if (randomItem) {
        const url = getResourceUrl(randomItem);
        console.log(
          `\n  🎲 ${c.bold}${randomItem.name}${c.reset} (${randomItem.category || "Tool"})`,
        );
        console.log(`     ${c.gray}${randomItem.description || ""}${c.reset}`);
        if (randomItem.freeTier)
          console.log(`     ${c.green}Free Tier:${c.reset} ${randomItem.freeTier}`);
        console.log(`     ${c.blue}${c.underline}${url}${c.reset}\n`);
        const openNow = (
          await question(`  ${c.green}Open in browser? [y/N]:${c.reset} `)
        ).toLowerCase();
        if (openNow === "y" || openNow === "yes") {
          openUrl(url);
        }
      }
      continue;
    }

    // Search query
    const results = searchCatalog(resources, input).slice(0, 10);
    if (results.length === 0) {
      console.log(`\n  ${c.red}No tools found matching "${input}".${c.reset}`);
      await question(`\n  ${c.gray}Press Enter to search again...${c.reset}`);
      continue;
    }

    console.log(`\n  🎯 Matches for "${c.bold}${input}${c.reset}" (${results.length} shown):\n`);
    results.forEach((item, idx) => {
      const free = item.freeTier ? ` ${c.green}[${item.freeTier}]${c.reset}` : "";
      const cat = item.category ? ` ${c.dim}(${item.category})${c.reset}` : "";
      console.log(
        `  ${c.purple}[${idx + 1}]${c.reset} ${c.bold}${item.name}${c.reset}${cat}${free}`,
      );
      console.log(`      ${c.gray}${item.description || ""}${c.reset}`);
    });

    const sel = (
      await question(
        `\n  ${c.green}Enter number to open URL in browser (or Enter to back):${c.reset} `,
      )
    ).trim();

    const idx = Number.parseInt(sel, 10) - 1;
    if (!Number.isNaN(idx) && results[idx]) {
      const targetUrl = getResourceUrl(results[idx]);
      console.log(`  🚀 Opening ${targetUrl}...`);
      openUrl(targetUrl);
      await question(`\n  ${c.gray}Press Enter to return to companion...${c.reset}`);
    }
  }
}

// Auto-run if executed directly as a script
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  startCompanion(process.argv.slice(2)).catch((err) => {
    console.error("DevShelf Companion Error:", err.message);
    process.exit(1);
  });
}
