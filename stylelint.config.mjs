import noSpecificityWhereRule from "./scripts/lint/stylelint-no-specificity-where.mjs";

export default {
  extends: ["stylelint-config-standard"],
  plugins: [noSpecificityWhereRule],
  rules: {
    "codex-panel/no-specificity-where": true,
    "color-named": "never",
    "color-no-hex": true,
    "custom-property-empty-line-before": null,
    "declaration-block-no-redundant-longhand-properties": null,
    "declaration-empty-line-before": null,
    "declaration-no-important": true,
    "declaration-property-value-disallowed-list": [
      {
        "/^(?:background(?:-color)?|border(?:-(?:block|inline|top|right|bottom|left))?(?:-color)?|box-shadow|caret-color|color|fill|outline(?:-color)?|stroke|text-shadow)$/":
          ["/(?:#[0-9a-fA-F]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\\()/", "/\\b(?:black|white)\\b/"],
        "/^--codex-panel-.*(?:accent|background|border|color|danger|error|faint|muted|ring|success|surface|text|warning).*$/": [
          "/(?:#[0-9a-fA-F]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\\()/",
          "/\\b(?:black|white)\\b/",
        ],
        "font-size": ["/\\b\\d*\\.?\\d+(?:px|rem|em|%)\\b/"],
        "font-weight": ["/^(?:[1-9]00|bold|bolder|lighter|normal)$/"],
        "line-height": ["/^(?:\\d*\\.?\\d+|\\d*\\.?\\d+(?:px|rem|em|%))$/"],
      },
      {
        message: "Use Obsidian or Codex Panel design tokens instead of hardcoded colors or typography.",
      },
    ],
    "declaration-property-unit-disallowed-list": [
      {
        "/^(?:border(?:-(?:block|inline|top|right|bottom|left))?-width|border-radius|bottom|column-gap|gap|height|inset|inset-(?:block|inline)|left|margin|margin-(?:block|inline|top|right|bottom|left)|max-height|max-width|min-height|min-width|padding|padding-(?:block|inline|top|right|bottom|left)|right|row-gap|top|width)$/":
          ["em", "px", "rem"],
      },
      {
        message: "Prefer Obsidian or Codex Panel spacing/size tokens for layout dimensions.",
      },
    ],
    "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch"],
    "keyframes-name-pattern": "^codex-panel-[a-z0-9-]+$",
    "max-nesting-depth": 2,
    "no-descending-specificity": null,
    "selector-class-pattern": null,
    "selector-max-compound-selectors": 4,
    "selector-max-specificity": "0,4,0",
    "selector-max-type": [
      0,
      {
        ignoreTypes: ["dd", "dt", "pre", "span", "summary", "svg", "ul"],
      },
    ],
    "selector-max-id": 0,
    "selector-disallowed-list": [
      ["/:has\\(/"],
      {
        message: "Avoid :has() because it can cause broad selector invalidation.",
      },
    ],
    "selector-max-universal": 0,
    "selector-not-notation": null,
  },
};
