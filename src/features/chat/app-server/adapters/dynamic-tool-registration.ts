import type { AppServerStartThreadOptions } from "../../../../app-server/services/threads";

export function panelDynamicTools(): NonNullable<AppServerStartThreadOptions["dynamicTools"]> {
  return [
    {
      type: "namespace",
      name: "codex_panel",
      description: "Read-only Obsidian integration tools provided by Codex Panel.",
      tools: [
        {
          type: "function",
          name: "resolve_wikilinks",
          description:
            "Resolve selected raw Obsidian wikilinks to vault-relative file paths, optionally using source-note context. This does not read file contents.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["wikilinks"],
            properties: {
              sourcePath: {
                type: "string",
                minLength: 1,
                maxLength: 1024,
                description:
                  "Optional vault-relative path of the note containing the links. Provide it for relative links and context-sensitive best-match resolution.",
              },
              wikilinks: {
                type: "array",
                minItems: 1,
                maxItems: 16,
                items: { type: "string", minLength: 4, maxLength: 1024 },
                description: "Raw wikilinks such as [[Note]], [[Note#Heading|label]], or [[../Note]].",
              },
            },
          },
        },
      ],
    },
  ];
}
