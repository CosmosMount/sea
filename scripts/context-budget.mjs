import { readFileSync } from "node:fs";
import { apply } from "../index.js";
import { CHAPTER_SCHEMA } from "../src/schema.js";

let prompt = "";
let tool;
apply({
  effect: (register) => register(),
  tools: {
    register: ({ name, description, parameters }) => {
      tool = { name, description, parameters };
      return () => {};
    },
  },
  commands: { register: () => () => {} },
  systemPrompt: {
    section: (section) => {
      prompt = section.text;
      return () => {};
    },
  },
});
const discovery = prompt.length + JSON.stringify(tool).length;
const deferred =
  JSON.stringify(CHAPTER_SCHEMA).length +
  readFileSync(
    new URL("../resources/generation-guide.md", import.meta.url),
    "utf8",
  ).length;
console.log(
  JSON.stringify(
    {
      beforePluginCharacters: 0,
      firstTurnDiscoveryCharacters: discovery,
      estimatedFirstTurnTokens: Math.ceil(discovery / 4),
      deferredGuideAndSchemaCharacters: deferred,
      estimatedDeferredTokens: Math.ceil(deferred / 4),
      estimator:
        "characters/4; not an exact model tokenizer or wire-prompt count",
    },
    null,
    2,
  ),
);
