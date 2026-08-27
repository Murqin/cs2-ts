# CS2-TS

An embedded TypeScript scripting layer for Counter-Strike 2, built on top of
[CounterStrikeSharp](https://github.com/roflmuffin/CounterStrikeSharp).

CS2-TS does not compete with CounterStrikeSharp and does not
reimplement the native Source 2 layer. It uses CSS as its runtime — native
interop, gamedata, schema access, the Metamod bridge, the .NET plugin host —
and exposes a flat, typed scripting API on top of it, so that simple CS2
plugins can be written as plain `.ts` files without a `.csproj`, a build step,
or a DLL deployment.

## Status: unproven hypothesis

**This project is a design proposal, not a commitment. Nothing here works yet.**

Its riskiest assumption — that the C# ↔ JavaScript boundary cost is acceptable
inside a tick budget — has not been measured. A Phase 0 measurement spike is a
gate, not a step: if the numbers miss their targets, the project stops there.

Prior art is not encouraging, and that is worth stating up front. Swiftly
shipped a JS/TS plugin layer and abandoned it (QuickJS was too slow, embedding
V8 in a C++ host proved "extremely complex"); its successor returned to C#. All
three actively maintained CS2 frameworks today are C#. The technical bet here
is narrower: on a .NET host, V8 embedding is a maintained NuGet package
(ClearScript) rather than a from-scratch integration.

## Architecture

```text
Source 2 / CS2 Dedicated Server
        ↓
Metamod:Source
        ↓
CounterStrikeSharp          native interop, gamedata, schema, .NET hosting
        ↓
CS2-TS Bridge     script-friendly facade + handle resolution
        ↓
ClearScript / V8            inline on the game thread
        ↓
plugins/*.ts
```

Four decisions carry the design:

- **Script-friendly facade.** The CSS object graph is not mirrored into
  JavaScript. `player.health = 100` replaces a deep traversal, and hides steps
  that fail silently when forgotten (such as `SetStateChanged`).
- **Inline execution on the game thread.** V8 engines under ClearScript have no
  thread affinity, so scripts run synchronously where the events fire. A
  one-way dispatcher returns background work (HTTP, database) to the game
  thread via `Server.NextFrame`.
- **Handle safety.** Script objects hold durable identities, never raw
  pointers. Every access re-resolves the entity and validates it, so touching a
  dead entity raises a catchable JavaScript error instead of crashing the
  server.
- **Typed developer experience.** An `@cs2-ts/api` type package provides IDE
  autocomplete and type checking on the developer's machine; the server only
  strips types and runs the result.

## The runtime is bare V8, not Node.js

This is a scope decision, and it comes first because it surprises people:

```text
fs      path    os      crypto      process     child_process
http    net     stream  Buffer      fetch       require()
```

None of these exist. Every asynchronous capability — timers, HTTP, filesystem,
database access — is a host API written on the C# side and explicitly exposed.
Most npm packages will not work; dependency-free, pure-JavaScript ones may.

Types are stripped, not compiled, using
[ts-blank-space](https://github.com/bloomberg/ts-blank-space). Only erasable
syntax is supported: `enum`, `namespace`, parameter properties and decorators
are rejected at author time by the shipped `tsconfig.json` rather than failing
on the server.

## Roadmap

| Phase | Scope | |
| --- | --- | --- |
| 0 | Measurement spike: dispatch overhead, handle resolution cost | **gate** |
| 1 | Type stripping, handle resolution, exception boundary, hot reload, watchdog | |
| 2 | Player and entity APIs, commands, timers, escape hatch | |
| 3 | `@cs2-ts/api`, editor support, documentation | |
| 4 | Module resolution, permissions, plugin distribution | |

## License

[MIT](LICENSE)
