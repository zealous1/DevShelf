import { Icon, MenuBarExtra, open } from "@raycast/api";
import { useFetch } from "@raycast/utils";

interface DevShelfItem {
  name: string;
  url?: string;
  repo?: string;
  category?: string;
  description: string;
  featured?: boolean;
}

interface ApiResponse {
  totalCount: number;
  tools: DevShelfItem[];
}

export default function MenuBarCompanion() {
  const { isLoading, data } = useFetch<ApiResponse>(
    "https://devshelf.ritualdev.in/api/v1/tools.json",
  );

  const tools = data?.tools || [];
  const featuredTools = tools.filter((t) => t.featured).slice(0, 8);
  const aiTools = tools.filter((t) => t.category?.toLowerCase().includes("ai")).slice(0, 5);
  const testingTools = tools
    .filter((t) => t.category?.toLowerCase().includes("testing") || t.category?.toLowerCase().includes("qa"))
    .slice(0, 5);
  const apis = tools.filter((t) => t.category?.toLowerCase().includes("api")).slice(0, 5);

  return (
    <MenuBarExtra
      icon="📚"
      tooltip="DevShelf — Free Developer Tools & APIs"
      isLoading={isLoading}
    >
      <MenuBarExtra.Section title="DevShelf Hub">
        <MenuBarExtra.Item
          title="Open DevShelf Directory"
          icon={Icon.Globe}
          onAction={() => open("https://devshelf.ritualdev.in")}
        />
        <MenuBarExtra.Item
          title="⚡ Interactive Web Playground"
          icon={Icon.Bolt}
          onAction={() => open("https://devshelf.ritualdev.in/playground.html")}
        />
        <MenuBarExtra.Item
          title="Live Health & Zero-Paywall Status"
          icon={Icon.CheckCircle}
          onAction={() => open("https://devshelf.ritualdev.in/status.html")}
        />
      </MenuBarExtra.Section>

      {featuredTools.length > 0 && (
        <MenuBarExtra.Section title="Featured Spotlight Tools">
          {featuredTools.map((tool) => (
            <MenuBarExtra.Item
              key={tool.name}
              title={`⭐ ${tool.name}`}
              subtitle={tool.description?.slice(0, 60)}
              onAction={() => open(tool.repo || tool.url || "https://devshelf.ritualdev.in")}
            />
          ))}
        </MenuBarExtra.Section>
      )}

      {aiTools.length > 0 && (
        <MenuBarExtra.Section title="Top AI Agents & Frameworks">
          {aiTools.map((tool) => (
            <MenuBarExtra.Item
              key={tool.name}
              title={`🤖 ${tool.name}`}
              onAction={() => open(tool.repo || tool.url || "https://devshelf.ritualdev.in")}
            />
          ))}
        </MenuBarExtra.Section>
      )}

      {apis.length > 0 && (
        <MenuBarExtra.Section title="Free Public APIs">
          {apis.map((tool) => (
            <MenuBarExtra.Item
              key={tool.name}
              title={`🔌 ${tool.name}`}
              onAction={() => open(tool.url || tool.repo || "https://devshelf.ritualdev.in")}
            />
          ))}
        </MenuBarExtra.Section>
      )}

      {testingTools.length > 0 && (
        <MenuBarExtra.Section title="Testing & QA Reliability">
          {testingTools.map((tool) => (
            <MenuBarExtra.Item
              key={tool.name}
              title={`🧪 ${tool.name}`}
              onAction={() => open(tool.repo || tool.url || "https://devshelf.ritualdev.in")}
            />
          ))}
        </MenuBarExtra.Section>
      )}
    </MenuBarExtra>
  );
}
