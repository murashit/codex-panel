import type { Thread } from "../../src/domain/threads/model";

export function panelThreadFixture(input: Pick<Thread, "id"> & Partial<Omit<Thread, "id">>): Thread {
  return {
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    ephemeral: false,
    provenance: { kind: "interactive" },
    ...input,
  };
}
