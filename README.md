# CS2-TS

An embedded TypeScript scripting layer for Counter-Strike 2, built on top of
[CounterStrikeSharp](https://github.com/roflmuffin/CounterStrikeSharp).

CS2-TS does not compete with CounterStrikeSharp and does not
reimplement the native Source 2 layer. It uses CSS as its runtime — native
interop, gamedata, schema access, the Metamod bridge, the .NET plugin host —
and exposes a flat, typed scripting API on top of it, so that simple CS2
plugins can be written as plain `.ts` files without a `.csproj`, a build step,
or a DLL deployment.

## Status: gate passed, early

**Phase 0 was a gate, not a step: if the boundary cost had missed its targets,
the project would have stopped there. It did not.** The riskiest assumptions are
now measured rather than assumed, on a Ryzen 7 5700X running de_dust2 with ten
bots:

| | Target | Measured |
| --- | ---: | ---: |
| Two V8 runtimes in one server process | no crash | works, see below |
| Dispatch, first crossing of a tick | < 25 µs | 20.45 (p50) |
| Dispatch, each further crossing in that tick | < 3 µs | 1.14 (p50) |
| Handle resolution | < 2 µs | 0.40 (p50) |
| Frametime against a no-V8 baseline | no difference | −0.14 ms (inside noise) |

Coexistence is not free: the CS2 server keeps Valve's own V8 11.9 in the global
symbol lookup scope, and ClearScript's V8 14.7 routes its own calls through the
PLT, so without `RTLD_DEEPBIND` plus a `DllImportResolver` pointed at that
handle the process aborts inside Valve's V8 on the first engine. Both halves are
required; see `src/Cs2Ts.Runtime/V8Bootstrap.cs`.

Phase 1's four parts are written and tested — type stripping, an exception boundary,
handle resolution, and a host with per-plugin engines, hot reload and a watchdog — but
none of it has been run inside a CS2 server yet, and there is no player API: a script
reaches the game through `handle.resolve()` for now. Treat it as unproven.

Prior art is not encouraging, and that is worth stating up front. Swiftly
shipped a JS/TS plugin layer and abandoned it (QuickJS was too slow, embedding
V8 in a C++ host proved "extremely complex"); its successor returned to C#. All
three actively maintained CS2 frameworks today are C#. The technical bet here
is narrower: on a .NET host, V8 embedding is a maintained NuGet package
(ClearScript) rather than a from-scratch integration.

## Where this sits next to Valve's `cs_script`

Valve replaced VScript with `cs_script`, a server-side JavaScript system, in
September 2025, and maintains an 876-line `point_script.d.ts` for it. If you are
writing a game mode, **use `cs_script`** — it is official, it is supported, and
CS2-TS does not try to replace it.

The difference is reach, not language. A `cs_script` is bound to a
`point_script` entity inside a map, so it ships with the map: you cannot drop a
`.ts` file onto a server running stock de_dust2 and add `!rank`. And by design
it has no network, no database, and no persistence across maps — workshop
content runs on other people's servers, so that restriction is a security
decision rather than an omission.

| | Written by | Cannot do |
| --- | --- | --- |
| `cs_script` | map and game-mode authors | run on stock maps, network, database, cross-map persistence |
| CS2-TS | server operators | — |

So CS2-TS is aimed at the classic CounterStrikeSharp workload — admin tools,
ranks, VIP, shops, Discord integration, database-backed stats — for people who
would rather write it in TypeScript than in C#. The audience it expects is not
"web developers" (see the bare-V8 section below for why that promise would not
survive contact); it is people who already learned `cs_script` and want the
same language on the operator's side of the server. `@cs2-ts/api` should
deliberately imitate `point_script.d.ts`'s naming and shape for that reason.

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
[ts-blank-space](https://github.com/bloomberg/ts-blank-space), which replaces
types with spaces — every line and column survives, so a V8 stack trace points
at the right place in the `.ts` file without a source map.

Only erasable syntax is supported. `enum`, `namespace`, parameter properties and
import aliases are rejected at author time by the shipped
[`tsconfig.json`](templates/tsconfig.json), whose `erasableSyntaxOnly` also has
`lib` and `types` pinned so that `fetch`, `process`, `setTimeout` and `console`
fail to type-check rather than to run. Decorators are the case that config
cannot catch — they are proposed JavaScript rather than a TypeScript extension —
so the stripper reports those itself, along with anything that does not parse.

## Roadmap

| Phase | Scope | |
| --- | --- | --- |
| 0 | Measurement spike: dispatch overhead, handle resolution cost | **passed** |
| 1 | Type stripping, handle resolution, exception boundary, hot reload, watchdog | **written, not yet run on a server** |
| 2 | Player and entity APIs, commands, timers, escape hatch | |
| 3 | `@cs2-ts/api`, editor support, documentation | |
| 4 | Module resolution, permissions, plugin distribution | |

## Building

The type stripper runs the official TypeScript parser inside V8, so the parser
has to be bundled into a single script before the .NET build can embed it. That
step needs Node; the rest does not.

```sh
cd tools/stripper && npm ci && npm run build   # writes Resources/stripper.js.gz
cd ../.. && dotnet build Cs2Ts.slnx
dotnet test tests/Cs2Ts.Runtime.Tests          # host side
cd tools/stripper && npm test                  # tsconfig, declarations, the example
```

`src/Cs2Ts.Runtime` holds everything with logic in it and knows nothing about
CounterStrikeSharp, so it is tested without a server.
`src/Cs2Ts.Plugin` is the binding: it starts V8 safely, turns CounterStrikeSharp
events into dispatches, and drains queued work once a tick.

## Writing a script

`templates/tsconfig.json` and `templates/cs2ts.d.ts` are what an author compiles
against; `examples/scripts/welcome.ts` is a working script, and it is exercised by
both test suites so it cannot drift away from the runtime.

```ts
on("player_connect", (player: PlayerHandle): void => {
    console.log(`player ${player.id} connected`);

    server.nextFrame((): void => {
        if (!player.isValid) {
            return;
        }
        console.log(`player ${player.id} is still here`);
    });
});
```

Drop a `.ts` file in the plugin's `scripts/` directory and it loads; save it again
and it reloads. `cs2ts_status` lists what is loaded.

## License

[MIT](LICENSE)
