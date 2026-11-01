import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadCatalog, searchCatalog } from "../../bin/lib/catalog.js";
import { loadNewsletter } from "../../bin/lib/newsletter.js";
import { loadSponsors } from "../../bin/lib/sponsors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DevShelfMcpInstance {
  server: McpServer;
  startStdio(): Promise<void>;
}

/**
 * Creates and initializes a typed DevShelf MCP Server using official @modelcontextprotocol/sdk
 */
export async function createDevShelfMcpServer(): Promise<DevShelfMcpInstance> {
  const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
  const pkg = fs.existsSync(pkgPath)
    ? JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    : { version: "1.1.2" };

  const server = new McpServer({
    name: "devshelf-mcp",
    version: pkg.version,
  });

  // 1. search_tools
  server.tool(
    "search_tools",
    "Search verified zero-paywall developer tools, open-source repositories, free public APIs, and AI agents. Returns name, description, URL, license, auth, and free tier details.",
    {
      query: z
        .string()
        .describe("Search keyword (e.g., 'postgres', 'weather', 'mock api', 'testing', 'llm')"),
      category: z
        .string()
        .optional()
        .describe("Optional filter by category (e.g., 'apis', 'ai', 'cli', 'testing', 'cloud')"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results to return (default: 8, max: 25)"),
      compact: z
        .boolean()
        .optional()
        .describe("If true, returns token-efficient condensed results for LLMs (default: false)"),
    },
    async (args) => {
      const catalog = await loadCatalog();
      const resources = catalog.resources || [];
      const matches = searchCatalog(resources, args.query, { category: args.category });
      const limit = Math.min(25, Math.max(1, args.limit || 8));
      const sliced = matches.slice(0, limit);

      if (args.compact) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                sliced.map((r: any) => ({
                  name: r.name,
                  category: r.category || r.section,
                  url: r.url || r.repo || r.deployUrl,
                  freeTier: r.freeTier || "100% Free Open Source",
                  altTo: r.alternativeTo || undefined,
                })),
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                totalMatches: matches.length,
                returned: sliced.length,
                query: args.query,
                tools: sliced,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 2. get_tool
  server.tool(
    "get_tool",
    "Get detailed information, documentation link, licensing, rate limit, and verification telemetry for a specific developer tool or API by name.",
    {
      name: z
        .string()
        .describe(
          "The exact or partial name of the tool (e.g., 'Bruno', 'Ollama', 'PocketBase', 'SkillPrism')",
        ),
    },
    async (args) => {
      const catalog = await loadCatalog();
      const resources = catalog.resources || [];
      const needle = args.name.toLowerCase().trim();
      const match = resources.find(
        (r: any) => r.name.toLowerCase() === needle || r.name.toLowerCase().includes(needle),
      );

      if (!match) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Tool '${args.name}' not found in DevShelf catalog.` }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(match, null, 2),
          },
        ],
      };
    },
  );

  // 3. find_free_alternatives
  server.tool(
    "find_free_alternatives",
    "Find verified 100% free and open-source alternatives to paid commercial or proprietary software (e.g., Postman -> Bruno/Hoppscotch, Airtable -> NocoDB, Datadog -> Prometheus).",
    {
      commercialTool: z
        .string()
        .describe(
          "Name of the proprietary or paid tool (e.g., 'Postman', 'Airtable', 'Firebase', 'Datadog')",
        ),
      compact: z
        .boolean()
        .optional()
        .describe("If true, returns token-efficient condensed results for LLMs"),
    },
    async (args) => {
      const catalog = await loadCatalog();
      const resources = catalog.resources || [];
      const target = args.commercialTool.toLowerCase().trim();
      const matches = resources.filter((r: any) =>
        (r.alternativeTo || "").toLowerCase().includes(target),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                commercialTool: args.commercialTool,
                alternativesCount: matches.length,
                alternatives: matches,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 4. list_categories
  server.tool(
    "list_categories",
    "List all curated categories and live resource counts available in DevShelf.",
    {},
    async () => {
      const catalog = await loadCatalog();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                totalCount: catalog.totalCount,
                milestone: catalog.milestone,
                categories: catalog.counts || {},
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 5. get_newsletter
  server.tool(
    "get_newsletter",
    "Retrieve the latest DevShelf Weekly developer newsletter edition or archive issues.",
    {
      issueNumber: z.number().optional().describe("Optional issue number (e.g. 1, 2)"),
      limit: z.number().optional().describe("Maximum issues to return"),
    },
    async (args) => {
      const nlData = await loadNewsletter();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(nlData, null, 2),
          },
        ],
      };
    },
  );

  return {
    server,
    async startStdio() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
