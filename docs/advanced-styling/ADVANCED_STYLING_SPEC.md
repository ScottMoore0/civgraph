# Advanced Styling Spec (v1)

This document defines Advanced Styling for the Boundaries website.

## Route Format (Hash)

- Compact (default): `#as/v1/c.<payload>`
- Verbose (optional): `#as/v1/v.<payload>`

`payload` is base64url encoded compressed JSON (pako/deflate).

## Share Limit

- Maximum full shareable URL length: `2000` chars.
- Compact/verbose link copying is blocked when this limit is exceeded.

## Config Shape (Verbose v1)

```json
{
  "version": "v1",
  "requiresLayers": ["layer-id-a", "layer-id-b"],
  "targetLayer": "layer-id-a",
  "where": "ctx.num('population',0) > 0",
  "style": {
    "fillOpacity": 0.6,
    "weight": 1.5
  },
  "rules": [
    {
      "if": "ctx.num('population',0) > 5000",
      "style": { "fillColor": "#1f77b4", "color": "#0b3a66" },
      "else": { "fillColor": "#d8d8d8", "color": "#777777" }
    }
  ]
}
```

## Runtime Behavior

1. Validate config.
2. Auto-load `requiresLayers` and `targetLayer` if not loaded.
3. Compile expressions.
4. Apply style evaluator to `targetLayer`.

## Expression Context

- `ctx.attr(name)`
- `ctx.has(name)`
- `ctx.num(name, defaultValue)`
- `ctx.str(name, defaultValue)`
- `ctx.between(value, lo, hi)`
- `ctx.votePct(party, year)` (property convention lookup)

## Security Model

- No direct arbitrary JS execution APIs are exposed.
- Expression characters are whitelisted.
- Unsupported expressions fail closed.

